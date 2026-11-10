"""Persistent, bounded diagnosis → support → unseen independent verification."""
from datetime import datetime, timezone
from uuid import uuid4
from ..domain.project_commands import ProjectCreate, ProjectAction, ProjectDraft
from ..domain.projects import LearningProject, LearningRound, LearningEvent, ProjectObservation, Finding
from ..domain.models import PracticeContent
from ..domain.learning_cases import CASE_TASK_ID, SKILL, ATOMS, CHECK, CASES, case_content, case_help
from ..domain.ports import UnitOfWorkFactory
from ..errors import AppError
from .content import ContentService
from .project_coach import ProjectCoach


def stamp():
    return datetime.now(timezone.utc).isoformat()


def uid():
    return uuid4().hex


def public(project: LearningProject) -> LearningProject:
    # A reference answer and unused candidate questions are never sent to the learner.
    rounds = [r.model_copy(update={"expected_value": None,
        "content": r.content.model_copy(update={"hint": "", "example_answer": ""}),
        "assessment": r.assessment.model_copy(update={"probe_question": "", "probe_atom_id": ""}) if r.assessment else None}) for r in project.rounds]
    return project.model_copy(update={"rounds": rounds})


class ProjectService:
    def __init__(self, work: UnitOfWorkFactory, content: ContentService, coach: ProjectCoach):
        self._work, self._content, self._coach = work, content, coach

    def get(self, project_id: str, user_id: str) -> LearningProject:
        with self._work.read() as unit:
            return public(unit.projects.get(project_id, user_id))

    def list(self, user_id: str) -> list[LearningProject]:
        with self._work.read() as unit:
            return [public(p) for p in unit.projects.list(user_id)]

    @staticmethod
    def _bind(unit, project: LearningProject, task_id: str) -> LearningProject:
        if task_id == CASE_TASK_ID:
            existing = {a.atomic_skill_id for a in unit.skills.atoms()}
            for atom in ATOMS:
                if atom.atomic_skill_id not in existing:
                    unit.skills.add_atom(atom)
            tasks = {s.skill_id for s in unit.skills.list()}
            if CASE_TASK_ID not in tasks:
                unit.skills.add(SKILL)
        skill = unit.skills.get(task_id)
        if not skill.enabled or not skill.atomic_skills:
            raise AppError("请选择已启用并配置原子的任务。", 409, "unsupported_task")
        return project.model_copy(update={"skill": skill, "atoms": [unit.skills.atom(a) for a in skill.atomic_skills],
            "status": "ready", "scope_note": "本项目在所选任务范围内评估；资料作为背景保存。本版尚不自动拆解任意学科。"})

    def create(self, command: ProjectCreate) -> LearningProject:
        values = command.model_dump(mode="json")
        with self._work.write() as unit:
            old = unit.projects.created(command.user_id, command.request_id, values)
            if old:
                return public(old)
            unit.users.ensure(command.user_id)
            now = stamp()
            project = LearningProject(project_id=uid(), user_id=command.user_id, goal=command.goal,
                background=command.background, deliverable=command.deliverable, source_text=command.source_text,
                status="pending", scope_note="目标已保存为待规划；请选择适用的任务，不会强行匹配不相关原子。",
                probe_limit=command.probe_limit, created_at=now, updated_at=now)
            if command.task_id:
                project = self._bind(unit, project, command.task_id)
            unit.projects.add(project, command.request_id, values)
        return public(project)

    def draft(self, project_id: str, command: ProjectDraft) -> LearningProject:
        with self._work.write() as unit:
            project = unit.projects.get(project_id, command.user_id)
            if not project.rounds or project.rounds[-1].round_id != command.round_id or project.rounds[-1].assessment:
                raise AppError("本轮已结束，请刷新进度。", 409, "round_finished")
            if unit.projects.busy(project_id):
                raise AppError("正在分析回答，请稍后。", 409, "project_busy")
            current = project.rounds[-1]
            if command.draft_number <= current.draft_number:
                if command.text == current.draft and command.numeric_answer == current.numeric_answer and (not command.assistance_used or current.assistance_used):
                    return public(project)
                raise AppError("草稿版本已变化，请刷新后继续。", 409, "project_revision_conflict")
            if command.revision != project.revision:
                raise AppError("另一窗口已更新草稿，请刷新后继续。", 409, "project_revision_conflict")
            updated = current.model_copy(update={"draft": command.text, "draft_number": command.draft_number,
                "numeric_answer": command.numeric_answer,
                "assistance_used": current.assistance_used or command.assistance_used})
            result = project.model_copy(update={"rounds": [*project.rounds[:-1], updated],
                "revision": project.revision + 1, "updated_at": stamp()})
            unit.projects.save(result, project.revision)
        return public(result)

    def act(self, project_id: str, command: ProjectAction) -> LearningProject:
        values = command.model_dump(mode="json")
        with self._work.write() as unit:
            project = unit.projects.get(project_id, command.user_id)
            if not unit.projects.claim(project, command.request_id, values):
                return public(project)
            if project.revision != command.revision:
                # Claim rollback is automatic on this error.
                raise AppError("进度已更新，请刷新后继续。", 409, "project_revision_conflict")
        try:
            if command.action == "bind":
                if project.status != "pending" or not command.task_id:
                    raise AppError("只能为待规划项目选择任务。", 409, "invalid_transition")
                with self._work.write() as unit:
                    result = self._bind(unit, project, command.task_id)
                observations = []
            else:
                result, observations = self._transition(project, command)
            result = result.model_copy(update={"revision": project.revision + 1, "updated_at": stamp()})
            with self._work.write() as unit:
                unit.projects.save(result, project.revision)
                for observation in observations:
                    unit.projects.add_observation(observation)
                unit.projects.done(project_id, command.request_id)
            return public(result)
        except BaseException:
            with self._work.write() as unit:
                unit.projects.release(project_id, command.request_id)
            raise

    @staticmethod
    def _event(project, kind, summary, **kwargs):
        return [*project.events, LearningEvent(event_id=uid(), kind=kind, created_at=stamp(), summary=summary, **kwargs)]

    def _new_round(self, project, stage):
        if len(project.rounds) >= 20:
            raise AppError("本项目已达20轮，请新建项目继续。", 409, "round_limit")
        expected, variant = None, None
        if project.skill.skill_id == CASE_TASK_ID:
            variant = sum(r.stage != "probe" for r in project.rounds)
            if variant >= len(CASES):
                raise AppError("本项目的新案例已用完，请结束回顾或另选任务；不会把看过的题当作新复测。", 409, "cases_exhausted")
            content, expected = case_content(variant)
        else:
            content = self._content.generate(project.skill, {"mode": "independent", "goal": project.goal,
                "background": project.background, "deliverable": project.deliverable,
                "source_text": project.source_text, "avoid_materials": [r.content.materials for r in project.rounds if r.stage != "probe"]}, project.atoms)
            if any(content.materials.strip() == r.content.materials.strip() for r in project.rounds):
                raise AppError("新题材料与旧题重复，请重试；本次未更新进度。", 502, "repeated_task")
        return LearningRound(round_id=uid(), stage=stage, content=content,
            target_ids=[a.atomic_skill_id for a in project.atoms], expected_value=expected, variant=variant)

    def _transition(self, project, command):
        action = command.action
        if not project.skill:
            raise AppError("目标已保存，请先选择适用的练习任务。", 409, "project_pending")
        if action in ("start", "verify", "retry"):
            allowed = {"start": {"ready"}, "verify": {"support", "review", "completed"}, "retry": {"support", "review", "completed"}}
            if project.status not in allowed[action]:
                raise AppError("请先完成或跳过当前轮。", 409, "invalid_transition")
            round_ = self._new_round(project, "initial" if action == "start" else "verification")
            return project.model_copy(update={"rounds": [*project.rounds, round_], "status": "answering", "findings": [],
                "decision_reason": "请独立完成当前任务；本轮结束后才汇总新的判断。",
                "probes_used": 0, "cycle": project.cycle + 1, "interventions": [],
                "events": self._event(project, action, "开始新任务；本轮独立作答，与之前提示后的表现分开记录。", round_id=round_.round_id)}), []
        if action == "skip":
            if project.status != "probing":
                raise AppError("当前没有可跳过的追问。", 409, "invalid_transition")
            return project.model_copy(update={"status": "support", "decision_reason": "用户跳过追问，保留尚不确定的判断。",
                "events": self._event(project, "skip", "跳过追问；不把未作答当成错误。")}), []
        if action == "finish":
            if project.status not in ("support", "review", "completed"):
                raise AppError("当前回答会自动保存，请先提交或跳过追问。", 409, "invalid_transition")
            return project.model_copy(update={"events": self._event(project, "finish", "已保存当前回顾，可稍后继续新任务。")}), []
        if action == "reflect":
            if project.status != "support" or not project.interventions or project.interventions[-1].level != "micro" or not command.answer.strip():
                raise AppError("请先选择局部练习并填写简短回答。", 409, "invalid_transition")
            if len([e for e in project.events if e.kind == "reflection"]) >= 20:
                raise AppError("练习记录已足够，请用新任务验证。", 409, "reflection_limit")
            return project.model_copy(update={"events": self._event(project, "reflection", "局部练习回答（有帮助，不计独立证据）：" + command.answer[:4000])}), []
        if action == "help":
            if project.status not in ("support", "review", "completed") or not project.findings:
                raise AppError("请先完成当前诊断。", 409, "invalid_transition")
            if len(project.interventions) >= 9:
                raise AppError("本轮帮助已足够，请尝试新任务检验。", 409, "help_limit")
            finding = next((f for f in project.findings if f.state == "gap"), next((f for f in project.findings if f.state == "uncertain"), project.findings[0]))
            if command.atomic_skill_id:
                selected = next((f for f in project.findings if f.atomic_skill_id == command.atomic_skill_id), None)
                if selected is None:
                    raise AppError("请选择本次诊断中的原子。", 422, "unknown_help_atom")
                finding = selected
            atom = next(a for a in project.atoms if a.atomic_skill_id == finding.atomic_skill_id)
            help_ = case_help(atom.atomic_skill_id, command.level) if project.skill.skill_id == CASE_TASK_ID else self._coach.help(atom, project.rounds[-1].content, command.level, finding.reason)
            help_ = help_.model_copy(update={"atomic_skill_id": atom.atomic_skill_id})
            return project.model_copy(update={"status": "support", "interventions": [*project.interventions, help_],
                "events": self._event(project, "help", f"针对「{atom.name}」提供{help_.title}；帮助本身不增加掌握证据。")}), []
        if action != "answer" or project.status not in ("answering", "probing"):
            raise AppError("当前阶段不支持此操作。", 409, "invalid_transition")
        current = project.rounds[-1]
        if current.round_id != command.round_id or current.assessment:
            raise AppError("提交轮次已变化，请刷新。", 409, "round_finished")
        if not command.answer.strip():
            raise AppError("请写下简短思路后提交。", 422, "answer_required")
        if current.expected_value is not None and command.numeric_answer is None:
            raise AppError("请同时填写净收入数值。", 422, "numeric_answer_required")
        targets = [a for a in project.atoms if a.atomic_skill_id in current.target_ids]
        assessment = self._coach.assess(targets, current.content, command.answer,
            [{"question": r.content.description, "answer": r.answer} for r in project.rounds[-3:] if r.assessment])
        findings = list(assessment.findings)
        if current.expected_value is not None and abs(command.numeric_answer - current.expected_value) > 0.005:
            findings = [Finding(atomic_skill_id=CHECK, state="gap", issue="explicit_error", quote="",
                reason="独立数值核验发现净收入与原始数据不一致；即使解释合理，也需要重新核对金额。",
                next_action="分别计算原始订单与退款合计，检查是否重复或遗漏。") if f.atomic_skill_id == CHECK else f for f in findings]
        assessment = assessment.model_copy(update={"findings": findings})
        assisted = current.assistance_used or command.assistance_used
        answered = current.model_copy(update={"answer": command.answer, "draft": command.answer,
            "numeric_answer": command.numeric_answer, "assistance_used": assisted, "assessment": assessment})
        combined = {f.atomic_skill_id: f for f in project.findings}
        combined.update({f.atomic_skill_id: f for f in findings})
        all_findings = [combined[a.atomic_skill_id] for a in project.atoms if a.atomic_skill_id in combined]
        observations = [ProjectObservation(observation_id=uid(), project_id=project.project_id,
            round_id=current.round_id, user_id=project.user_id, atomic_skill_id=f.atomic_skill_id,
            context=project.skill.context, stage=current.stage, assistance_used=assisted,
            finding=f, created_at=stamp()) for f in findings]
        probe = next((f for f in all_findings if f.atomic_skill_id == assessment.probe_atom_id and f.state == "uncertain" and f.issue == "missing_evidence"), None)
        cycle_start = max(i for i, r in enumerate(project.rounds) if r.stage != "probe")
        asked = {a for r in project.rounds[cycle_start:] if r.stage == "probe" for a in r.target_ids}
        can_probe = (probe is not None and assessment.probe_value == "high" and assessment.probe_question.strip()
            and project.probes_used < project.probe_limit and probe.atomic_skill_id not in asked
            and not any(f.state == "gap" for f in all_findings))
        rounds = [*project.rounds[:-1], answered]
        if can_probe:
            question = PracticeContent(title="一个简短确认", description=assessment.probe_question,
                materials=current.content.materials, target_atomic_ids=[probe.atomic_skill_id])
            rounds.append(LearningRound(round_id=uid(), stage="probe", content=question, target_ids=[probe.atomic_skill_id], assistance_used=assisted))
            status, reason = "probing", assessment.decision_reason
        else:
            supported = len(all_findings) == len(project.atoms) and all(f.state == "supported" for f in all_findings)
            # A successful probe never turns an incomplete retest into independent mastery.
            independent_verified = current.stage == "verification" and supported and not assisted
            status = "completed" if independent_verified else "review" if supported else "support"
            reason = ("新任务中所有目标均有独立证据；仍需在后续情境检验稳定性。" if independent_verified else
                "已有足够证据，结束追问；可通过新任务独立复测。" if supported else
                "存在明确缺口，直接进入帮助。" if any(f.state == "gap" for f in all_findings) else
                "已结束本轮诊断，保留不确定项；可获取帮助或换新任务验证。")
        events = self._event(project, "assessment", assessment.summary, round_id=current.round_id,
            decision=reason, evidence_ids=[o.observation_id for o in observations])
        return project.model_copy(update={"rounds": rounds, "findings": all_findings, "status": status,
            "probes_used": project.probes_used + int(bool(can_probe)), "decision_reason": reason, "events": events}), observations
