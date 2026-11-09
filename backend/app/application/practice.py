from __future__ import annotations
import uuid
from ..domain.learning import utc_now
from ..domain.models import (
    AtomicSkill, Evaluation, EvidenceRecord, JsonObject, PracticeContent, PracticeRecord, PracticeSession,
    SessionDetails, SessionHistory, SessionStarted, Submission,
)
from ..domain.ports import UnitOfWork, UnitOfWorkFactory
from ..errors import AppError
from .content import ContentService
from .skills import require_active
from .bridge import prepare_case


class PracticeService:
    def __init__(self, work: UnitOfWorkFactory, content: ContentService):
        self._work, self._content = work, content

    def generate(self, skill_id: str, params: JsonObject) -> PracticeContent:
        with self._work.read() as unit:
            skill = require_active(unit.skills.get(skill_id))
            atoms, effective = self._prepare(unit, skill, params)
        return self._visible_content(self._content.generate(skill, effective, atoms), effective)

    @staticmethod
    def _prepare(unit: UnitOfWork, skill, params: JsonObject, user_id: str | None = None) -> tuple[list[AtomicSkill], JsonObject]:
        effective = {**skill.default_params, **params}
        # Case defaults belong to the case; explicit caller choices still win.
        if params.get("bridge_case_id") is not None:
            effective.pop("mode", None)
            effective.pop("target_atomic_ids", None)
            effective.update({key: params[key] for key in ("mode", "target_atomic_ids") if key in params})
        effective = prepare_case(unit, skill, effective, user_id)
        mode = effective.get("mode", "guided")
        if mode not in ("guided", "independent", "transfer"):
            raise AppError("请选择引导、独立或迁移练习模式。", 422, "invalid_practice_mode")
        targets = effective.get("target_atomic_ids", skill.atomic_skills)
        if (not isinstance(targets, list) or not targets or len(targets) > 10
                or any(not isinstance(atom_id, str) for atom_id in targets)):
            raise AppError("目标原子须为任务中的非空ID列表。", 422, "invalid_targets")
        if len(set(targets)) != len(targets) or not set(targets).issubset(skill.atomic_skills):
            raise AppError("目标原子不属于该任务或存在重复。", 422, "invalid_targets")
        atoms = [unit.skills.atom(atom_id) for atom_id in targets]
        if any(skill.context not in atom.contexts for atom in atoms):
            raise AppError("任务情境不在原子适用范围内。", 422, "invalid_context")
        effective.update(mode=mode, target_atomic_ids=targets)
        return atoms, effective

    @staticmethod
    def _visible_content(content, params: JsonObject, completed: bool = False):
        if not completed and params.get("mode", "guided") != "guided":
            return content.model_copy(update={"hint": "", "example_answer": ""})
        return content

    def start(self, user_id: str, skill_id: str, params: JsonObject) -> SessionStarted:
        with self._work.read() as unit:
            skill = require_active(unit.skills.get(skill_id))
            atoms, effective = self._prepare(unit, skill, params, user_id)
        content = self._content.generate(skill, effective, atoms)
        session = PracticeSession(session_id=uuid.uuid4().hex, user_id=user_id, skill_id=skill_id,
            content=content, skill_snapshot=skill, atom_snapshot=atoms, params=effective, started_at=utc_now())
        with self._work.write() as unit:
            # Recheck after model latency, while preserving the actual generation snapshot.
            require_active(unit.skills.get(skill_id))
            unit.users.ensure(user_id)
            unit.practices.add(session)
            names = {a.atomic_skill_id: a.name for a in atoms}
        return SessionStarted(session_id=session.session_id, skill_id=skill_id, question=content.title,
            content=self._visible_content(content, effective), start_time=session.started_at, atomic_skill_names=names,
            mode=effective["mode"], atom_snapshot=atoms, agent_trace=content.agent_trace,
            bridge_case_id=effective.get("bridge_case_id"), source_session_id=effective.get("source_session_id"))

    def evaluate(self, skill_id: str, answer: str, reference: str, params: JsonObject) -> Evaluation:
        with self._work.read() as unit:
            skill = require_active(unit.skills.get(skill_id))
            atoms, effective = self._prepare(unit, skill, params)
        return self._content.evaluate(skill, atoms, answer, reference, effective)

    @staticmethod
    def _completed(unit: UnitOfWork, session: PracticeSession, answer: str | None = None) -> Submission:
        if answer is not None and unit.practices.latest_answer(session.session_id) != answer:
            raise AppError("该会话已提交其他答案，请开始新的练习。", 409, "session_answer_conflict")
        if session.result is None:
            raise AppError("已完成会话缺少评估记录，请检查数据库。", 500, "missing_session_result")
        return Submission(session_id=session.session_id, evaluation_result=session.result,
                          record_id=unit.practices.record_id(session.session_id))

    def submit(self, user_id: str, session_id: str, answer: str, assistance_used: bool = False) -> Submission:
        with self._work.read() as unit:
            session = unit.practices.get(session_id, user_id)
            if session.status == "completed":
                return self._completed(unit, session, answer)
            atoms = session.atom_snapshot
        skill = session.skill_snapshot
        result = self._content.evaluate(skill, atoms, answer, session.content.model_dump(mode="json"), session.params)
        with self._work.write() as unit:
            current = unit.practices.get(session_id, user_id)
            if current.status == "completed":
                return self._completed(unit, current, answer)
            # Timestamp follows acquisition of the write lock so evidence stays ordered.
            stamp = utc_now()
            record = PracticeRecord(record_id=uuid.uuid4().hex, session_id=session_id, user_id=user_id,
                skill_id=skill.skill_id, skill_name=skill.display_name, **session.content.model_dump(exclude={"agent_trace"}),
                input_type="text", transcript=answer, score=round(result.score * 10, 2),
                strengths=result.strengths, improvements=result.improvements, ai_comment=result.aiComment,
                start_time=session.started_at, end_time=stamp, atomic_skill_scores=result.atomic_skill_scores,
                atomic_skill_names={a.atomic_skill_id: a.name for a in atoms},
                evidence=result.evidence, agent_trace=[*session.content.agent_trace, *result.agent_trace],
                mode=session.params["mode"], context=skill.context,
                bridge_case_id=session.params.get("bridge_case_id"), source_session_id=session.params.get("source_session_id"),
                assistance_used=assistance_used or session.params["mode"] == "guided")
            unit.practices.complete(session_id, answer, result, stamp)
            unit.practices.add_record(record)
            for evidence in result.evidence:
                unit.progress.add_evidence(user_id, EvidenceRecord(**evidence.model_dump(),
                    session_id=session_id, context=skill.context, mode=session.params["mode"],
                    assistance_used=record.assistance_used, created_at=stamp))
            return Submission(session_id=session_id, evaluation_result=result, record_id=record.record_id)

    def session_details(self, user_id: str, session_id: str) -> SessionDetails:
        with self._work.read() as unit:
            session = unit.practices.get(session_id, user_id)
            names = {a.atomic_skill_id: a.name for a in session.atom_snapshot}
            details = SessionDetails(session_id=session_id, skill_id=session.skill_id, status=session.status,
                content=self._visible_content(session.content, session.params, session.status == "completed"),
                start_time=session.started_at, atomic_skill_names=names,
                mode=session.params["mode"], atom_snapshot=session.atom_snapshot, agent_trace=session.content.agent_trace,
                bridge_case_id=session.params.get("bridge_case_id"), source_session_id=session.params.get("source_session_id"))
            if session.status == "completed":
                completed = self._completed(unit, session)
                details = details.model_copy(update={"evaluation_result": completed.evaluation_result,
                    "record_id": completed.record_id, "answer": unit.practices.latest_answer(session_id) or ""})
            return details

    def history(self, user_id: str, skill_id: str | None = None) -> list[SessionHistory]:
        with self._work.read() as unit:
            history = unit.practices.history(user_id, skill_id)
        return [item.model_copy(update={"content": self._visible_content(
            item.content, {"mode": item.mode}, item.status == "completed")}) for item in history]
