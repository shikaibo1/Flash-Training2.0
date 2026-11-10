"""Context-specific evidence summaries and transparent, deterministic practice advice."""
from ..domain.models import (
    AgentStep, AtomicEvidenceSummary, AtomicSkill, ContextEvidence,
    EvidenceRecord, LearningRecommendation, LearningRecommendations, Skill,
)
from ..domain.ports import UnitOfWorkFactory
from ..domain.projects import ProjectObservation
from ..domain.evidence_views import EvidenceDashboard


def _independent_success(record: EvidenceRecord) -> bool:
    return (record.status == "observed" and record.score is not None and record.score >= 7
            and record.mode in ("independent", "transfer") and not record.assistance_used)


def _summarize(atoms: list[AtomicSkill], evidence: list[EvidenceRecord], project_observations: list[ProjectObservation] | None = None) -> list[AtomicEvidenceSummary]:
    summaries = []
    for atom in atoms:
        atom_records = [record for record in evidence if record.atomic_skill_id == atom.atomic_skill_id]
        project_records = [o for o in (project_observations or []) if o.atomic_skill_id == atom.atomic_skill_id]
        contexts = list(dict.fromkeys([*atom.contexts, *(record.context for record in atom_records), *(o.context for o in project_records)]))
        context_summaries = []
        for context in contexts:
            observed = [record for record in atom_records if record.context == context and record.status == "observed"]
            latest = observed[0] if observed else None
            status = "unmeasured"
            if latest is not None:
                if latest.score < 7:
                    status = "developing"
                elif latest.mode == "guided" or latest.assistance_used:
                    status = "assisted"
                else:
                    status = "independent"
            project_items = [o for o in project_records if o.context == context]
            latest_project = project_items[0] if project_items else None
            use_project = latest_project is not None and (latest is None or latest_project.created_at >= latest.created_at)
            if use_project:
                state = latest_project.finding.state
                status = ("uncertain" if state == "uncertain" else "developing" if state == "gap" else
                    "assisted" if latest_project.stage == "probe" or latest_project.assistance_used else "independent")
            context_summaries.append(ContextEvidence(
                context=context, status=status, evidence_count=len(observed) + len(project_items),
                independent_count=sum(_independent_success(record) for record in observed) + sum(o.finding.state == "supported" and o.stage != "probe" and not o.assistance_used for o in project_items),
                last_score=latest.score if latest and not use_project else None,
                last_practice_time=latest_project.created_at if use_project else latest.created_at if latest else None,
            ))
        successful = [record for record in atom_records if _independent_success(record)]
        transfer = len({record.context for record in successful}) >= 2 and any(record.mode == "transfer" for record in successful)
        summaries.append(AtomicEvidenceSummary(atomic_skill_id=atom.atomic_skill_id, name=atom.name,
                                                contexts=context_summaries, transfer_observed=transfer))
    return summaries


def _context_state(summary: AtomicEvidenceSummary, context: str) -> ContextEvidence:
    return next((state for state in summary.contexts if state.context == context), ContextEvidence(context=context, status="unmeasured"))


def _priority(state: ContextEvidence) -> tuple[int, float, str]:
    category = {"unmeasured": 1, "uncertain": 1, "developing": 2, "assisted": 3, "independent": 5}[state.status]
    # Missing evidence is represented by its own category, never a fictitious zero score.
    return category, state.last_score if state.last_score is not None else 10.0, state.last_practice_time or ""


class EvidenceService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    def dashboard(self, user_id: str) -> EvidenceDashboard:
        with self._work.read() as unit:
            atoms = unit.skills.atoms()
            evidence = unit.progress.evidence(user_id)
            observations = unit.projects.observations(user_id)
        return EvidenceDashboard(atomic_skills=_summarize(atoms, evidence, observations), recent_evidence=evidence[:100],
            project_observations=observations[:100])

    def recommendations(self, user_id: str) -> LearningRecommendations:
        with self._work.read() as unit:
            atoms = unit.skills.atoms()
            evidence = unit.progress.evidence(user_id)
            tasks = unit.skills.list(enabled_only=True)
            observations = unit.projects.observations(user_id)
        summaries = {summary.atomic_skill_id: summary for summary in _summarize(atoms, evidence, observations)}
        atom_definitions = {atom.atomic_skill_id: atom for atom in atoms}
        candidates = {}

        def offer(task: Skill, priority: tuple, reason: str, preferred: list[str]) -> None:
            target_ids = list(dict.fromkeys([*preferred, *task.atomic_skills]))[:4]
            recommendation = LearningRecommendation(skill_id=task.skill_id, title=task.display_name,
                context=task.context, reason=reason, target_atomic_ids=target_ids)
            existing = candidates.get(task.skill_id)
            if existing is None or priority < existing[0]:
                candidates[task.skill_id] = (priority, recommendation)

        for task_index, task in enumerate(tasks):
            if not task.atomic_skills:
                continue
            targets = sorted(task.atomic_skills, key=lambda atom_id: _priority(_context_state(summaries[atom_id], task.context)))
            missing_prerequisites = list(dict.fromkeys(prior_id for atom_id in targets
                for prior_id in atom_definitions[atom_id].prerequisite_ids
                if _context_state(summaries[prior_id], task.context).status != "independent"))
            if missing_prerequisites:
                prior_id = missing_prerequisites[0]
                prior_name = atom_definitions[prior_id].name
                # A focused prerequisite exercise should precede a composite task
                # that happens to include the same prerequisite among its targets.
                prerequisite_tasks = [option for option in tasks
                    if option.context == task.context and prior_id in option.atomic_skills]
                prerequisite_task = min(prerequisite_tasks, key=lambda option: len(option.atomic_skills), default=None)
                if prerequisite_task is not None:
                    offer(prerequisite_task, (0, 0.0, "", task_index),
                          f"建议先补齐同情境前置技能「{prior_name}」的独立完成证据；仍可直接尝试「{task.display_name}」，不设解锁限制。", [prior_id])
                else:
                    offer(task, (0, 1.0, "", task_index),
                          f"前置技能「{prior_name}」在「{task.context}」缺少独立完成证据，目录暂无同情境前置练习；可直接尝试本任务并关注此前置缺口。", targets)
                continue
            state = _context_state(summaries[targets[0]], task.context)
            priority = _priority(state)
            if state.status in ("unmeasured", "uncertain"):
                reason = f"「{task.context}」尚无可观察证据，先建立基线。"
                source = next(((atom_id, context.context) for atom_id in targets
                    if _context_state(summaries[atom_id], task.context).status == "unmeasured"
                    for context in summaries[atom_id].contexts
                    if context.context != task.context and context.independent_count > 0), None)
                if source is not None:
                    atom_id, source_context = source
                    reason = (f"「{atom_definitions[atom_id].name}」在「{source_context}」已有独立达标证据，"
                              f"可在「{task.context}」选择迁移模式建立单独证据；不传播原情境分数。")
            elif state.status == "developing":
                reason = (f"优先练习本情境较弱项，最近可观察得分为 {state.last_score:g}/10。" if state.last_score is not None
                          else "本情境最近的诊断发现明确缺口，建议针对性帮助后再独立验证。")
            elif state.status == "assisted":
                reason = "已在辅助下完成，建议收起提示后独立练习。"
            elif any(not summaries[atom_id].transfer_observed for atom_id in targets):
                transfer_target = next(((atom_id, option) for atom_id in targets
                    if not summaries[atom_id].transfer_observed
                    for option in tasks if option.context != task.context and atom_id in option.atomic_skills
                    and _context_state(summaries[atom_id], option.context).independent_count == 0), None)
                if transfer_target is not None:
                    atom_id, destination = transfer_target
                    name = atom_definitions[atom_id].name
                    offer(destination, (4, priority[1], priority[2], task_index),
                          f"「{name}」已有「{task.context}」独立证据，建议在「{destination.context}」选择迁移模式单独取证；不传播原情境分数。", [atom_id])
                reason = "本情境已有独立证据，可换案例复习；同情境新案例不构成跨情境证据。"
            else:
                reason = "已具备独立及跨情境证据，可间隔复习以观察稳定性。"
            offer(task, (*priority, task_index), reason, targets)
        ordered = sorted(candidates.values(), key=lambda candidate: candidate[0])
        return LearningRecommendations(recommendations=[item[1] for item in ordered[:6]], agent_trace=[AgentStep(
            agent="learning_planner", method="rule",
            summary="按情境独立取证：前置缺口、未测、薄弱、辅助后独立、迁移、间隔复习。迁移观察仅指至少两个情境均有无辅助达标证据且包含迁移练习，不是掌握概率。")])
