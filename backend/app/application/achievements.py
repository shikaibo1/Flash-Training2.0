from datetime import datetime, timezone
from ..domain.achievements import CATALOG, AchievementAward, AchievementDashboard, AchievementItem
from ..domain.achievement_rules import evaluate
from ..domain.ports import UnitOfWorkFactory
from ..errors import AppError


class AchievementService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    @staticmethod
    def _progress(unit, user_id):
        return {p.achievement_id: p for p in evaluate(unit.projects.list(user_id),
            unit.practices.history(user_id), unit.progress.evidence(user_id), unit.projects.observations(user_id))}

    @staticmethod
    def _dashboard(progress, awards):
        saved = {award.achievement_id: award for award in awards}
        items = [AchievementItem(**definition.model_dump(),
            progress=definition.target if definition.id in saved else min(progress[definition.id].count, definition.target),
            unlocked=definition.id in saved, award=saved.get(definition.id)) for definition in CATALOG]
        return AchievementDashboard(items=items, unlocked_count=sum(i.unlocked for i in items), total=len(items),
            unread_ids=[i.id for i in items if i.award and i.award.seen_at is None],
            completed_tasks=progress['first_task'].count, independent_tasks=progress['first_independent'].count,
            independent_atoms=progress['three_atoms'].count)

    def get(self, user_id: str) -> AchievementDashboard:
        with self._work.read() as unit:
            return self._dashboard(self._progress(unit, user_id), unit.achievements.list(user_id))

    def sync(self, user_id: str) -> AchievementDashboard:
        # One short database transaction makes concurrent tabs and retries idempotent.
        # Sources are snapshots only; no external work is performed while holding the lock.
        with self._work.write() as unit:
            progress = self._progress(unit, user_id)
            existing = {award.achievement_id for award in unit.achievements.list(user_id)}
            stamp = datetime.now(timezone.utc).isoformat()
            for definition in CATALOG:
                proof = progress[definition.id].proof
                if proof and definition.id not in existing:
                    unit.achievements.add(user_id, AchievementAward(achievement_id=definition.id,
                        rule_version=definition.rule_version, awarded_at=stamp, **proof.model_dump()))
            return self._dashboard(progress, unit.achievements.list(user_id))

    def seen(self, user_id: str, ids: list[str]) -> AchievementDashboard:
        if not set(ids) <= {definition.id for definition in CATALOG}:
            raise AppError('成就不存在，请刷新后重试。', 422, 'unknown_achievement')
        with self._work.write() as unit:
            unit.achievements.mark_seen(user_id, ids, datetime.now(timezone.utc).isoformat())
            return self._dashboard(self._progress(unit, user_id), unit.achievements.list(user_id))
