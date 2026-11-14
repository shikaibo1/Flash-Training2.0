"""Read complete, owner-scoped evidence without the dashboard's recent-item limit."""
from datetime import datetime, timezone
from ..domain.goal_graph import EvidenceTimeline, EvidenceTimelineItem
from ..domain.ports import UnitOfWorkFactory
from ..errors import AppError
from .evidence import practice_evidence_status, project_evidence_status


def timestamp(value: str) -> float:
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    return parsed.replace(tzinfo=timezone.utc).timestamp() if parsed.tzinfo is None else parsed.timestamp()


class EvidenceTimelineService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    def timeline(self, user_id: str, atom_id: str, context: str | None,
                 project_id: str | None, offset: int, limit: int) -> EvidenceTimeline:
        with self._work.read() as unit:
            # Project filtering must also enforce ownership when there are no observations.
            selected_project = unit.projects.get(project_id, user_id) if project_id else None
            practice_records = [] if project_id else [r for r in unit.progress.evidence(user_id)
                                                       if r.atomic_skill_id == atom_id]
            observations = [o for o in unit.projects.observations(user_id)
                            if o.atomic_skill_id == atom_id and (not project_id or o.project_id == project_id)]
            known = any(a.atomic_skill_id == atom_id for a in unit.skills.atoms())
            if not known and not practice_records and not observations:
                owned_projects = [selected_project] if selected_project else unit.projects.list(user_id)
                known_snapshot = any(a.atomic_skill_id == atom_id for p in owned_projects for a in p.atoms)
                if not known_snapshot:
                    raise AppError('原子及其证据不存在。', 404, 'atom_not_found')
            contexts = sorted({r.context for r in practice_records} | {o.context for o in observations})
            practice_records = [r for r in practice_records if context is None or r.context == context]
            observations = [o for o in observations if context is None or o.context == context]
            # Sort metadata first; only resolve full snapshots for the requested page.
            entries = [(timestamp(r.created_at), f'practice:{r.session_id}:{atom_id}', 'practice', r)
                       for r in practice_records]
            entries.extend((timestamp(o.created_at), f'project:{o.observation_id}', 'project', o)
                           for o in observations)
            entries.sort(key=lambda entry: (entry[0], entry[1]), reverse=True)
            sessions, projects, items = {}, {}, []
            if selected_project:
                projects[selected_project.project_id] = selected_project
            for _, entry_id, source, record in entries[offset:offset + limit]:
                if source == 'practice':
                    if record.session_id not in sessions:
                        sessions[record.session_id] = unit.practices.get(record.session_id, user_id)
                    session = sessions[record.session_id]
                    definition = next((a for a in session.atom_snapshot if a.atomic_skill_id == atom_id), None)
                    items.append(EvidenceTimelineItem(id=entry_id, source=source, context=record.context,
                        stage='practice', mode=record.mode, assistance_used=record.assistance_used,
                        status=practice_evidence_status(record), quote=record.quote, reason=record.reason,
                        next_action=record.next_action, created_at=record.created_at, score=record.score,
                        session_id=record.session_id, skill_id=session.skill_id, title=session.content.title,
                        definition_version=definition.version if definition else None))
                else:
                    if record.project_id not in projects:
                        projects[record.project_id] = unit.projects.get(record.project_id, user_id)
                    project = projects[record.project_id]
                    original_round = next((r for r in project.rounds if r.round_id == record.round_id), None)
                    definition = next((a for a in project.atoms if a.atomic_skill_id == atom_id), None)
                    items.append(EvidenceTimelineItem(id=entry_id, source=source, context=record.context,
                        stage=record.stage, mode=None, assistance_used=record.assistance_used,
                        status=project_evidence_status(record), quote=record.finding.quote,
                        reason=record.finding.reason, next_action=record.finding.next_action,
                        created_at=record.created_at, score=None, project_id=record.project_id,
                        round_id=record.round_id,
                        title=original_round.content.title if original_round else f'{project.goal}（原轮次未找到）',
                        definition_version=definition.version if definition else None))
        return EvidenceTimeline(atomic_skill_id=atom_id, items=items, contexts=contexts,
                                total=len(entries), offset=offset, limit=limit)
