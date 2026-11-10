"""Controlled case preparation, descriptive pairing, and bounded diagnosis.

PracticeService remains the sole owner of practice generation/submission and
learning evidence. This service never writes a practice score or atom evidence.
"""
from __future__ import annotations
from copy import deepcopy
from ..domain.bridge import LIMITATIONS, PROBES, PROBE_KEYS, TARGETS, catalog, get_case, public_case
from ..domain.learning import utc_now
from ..domain.models import EvidenceRecord, JsonObject, PracticeSession, Skill
from ..domain.ports import UnitOfWork, UnitOfWorkFactory
from ..errors import AppError


def prepare_case(unit: UnitOfWork, skill: Skill, params: JsonObject, user_id: str | None) -> JsonObject:
    """Validate learner-owned pairing before producing trusted case metadata."""
    case_id = params.get("bridge_case_id")
    if case_id is None:
        if "source_session_id" in params or "bridge_case_snapshot" in params:
            raise AppError("来源会话与案例快照必须关联受控案例。", 422, "invalid_bridge_params")
        return params
    case = get_case(case_id)
    if skill.skill_id != "t_conversion":
        raise AppError("受控案例仅适用于转化率任务。", 422, "bridge_task_mismatch")
    effective = {**params}
    effective.setdefault("mode", case["allowed_modes"][-1])
    effective.setdefault("target_atomic_ids", TARGETS)
    if effective["mode"] not in case["allowed_modes"]:
        raise AppError("所选模式不适用于此受控案例。", 422, "bridge_mode_mismatch")
    targets = effective["target_atomic_ids"]
    if not isinstance(targets, list) or len(targets) != len(TARGETS) or any(
            not isinstance(target, str) for target in targets) or set(targets) != set(TARGETS):
        raise AppError("受控案例必须包含提取、指标、比较三个固定目标原子。", 422, "bridge_targets_mismatch")
    source_id = effective.get("source_session_id")
    if source_id is not None and (not isinstance(source_id, str) or not source_id.strip() or len(source_id) > 200):
        raise AppError("来源会话ID无效。", 422, "invalid_bridge_source")
    if case["requires_source"] and source_id is None:
        raise AppError("请先选择一个已完成的基线会话作为配对来源。", 422, "bridge_source_required")
    if source_id is not None:
        if user_id is None:
            raise AppError("配对案例请通过带用户ID的开始练习接口创建。", 422, "bridge_start_required")
        source = unit.practices.get(source_id, user_id)
        source_case = source.params.get("bridge_case_snapshot")
        if (source.status != "completed" or source.result is None or source.skill_id != skill.skill_id
                or not isinstance(source_case, dict) or source_case.get("stage") != "baseline"
                or {atom.atomic_skill_id for atom in source.atom_snapshot} != set(TARGETS)):
            raise AppError("来源必须是同一用户已完成、目标一致的受控基线会话。", 422, "invalid_bridge_source")
        if case["stage"] == "baseline":
            raise AppError("基线练习不接受配对来源。", 422, "invalid_bridge_source")
    effective["bridge_case_snapshot"] = public_case(case)
    return effective


class BridgeService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    @staticmethod
    def catalog() -> JsonObject:
        return catalog()

    @staticmethod
    def _case(session: PracticeSession) -> dict:
        case = session.params.get("bridge_case_snapshot")
        if not isinstance(case, dict):
            raise AppError("该会话不是受控案例练习。", 404, "bridge_session_not_found")
        return case

    @staticmethod
    def _comparison(unit: UnitOfWork, session: PracticeSession, evidence: list[EvidenceRecord]) -> dict:
        source_id = session.params.get("source_session_id")
        result = {"status": "unpaired", "reason": "本次未关联基线，只作为单次练习记录。",
                  "source_session_id": source_id, "atoms": [], "limitations": LIMITATIONS}
        if not source_id:
            return result
        source = unit.practices.get(source_id, session.user_id)
        if session.status != "completed" or not session.result or not source.result:
            return {**result, "status": "pending", "reason": "本次练习完成后才能比较。"}
        source_case = source.params.get("bridge_case_snapshot")
        current_case = session.params.get("bridge_case_snapshot")
        if (not isinstance(source_case, dict) or not isinstance(current_case, dict)
                or source_case.get("case_id") != "conversion_baseline"
                or source_case.get("stage") != "baseline"
                or source.params.get("bridge_case_id") != source_case.get("case_id")
                or session.params.get("bridge_case_id") != current_case.get("case_id")
                or current_case.get("stage") not in ("representation", "boundary", "synthesis")
                or source.skill_id != session.skill_id
                or type(source_case.get("comparison_version")) is not int
                or type(current_case.get("comparison_version")) is not int
                or source_case["comparison_version"] < 1
                or source_case["comparison_version"] != current_case.get("comparison_version")):
            return {**result, "status": "not_comparable", "reason": "来源不是有效基线，或双方受控材料不属于同一比较版本，不报告配对分差。"}
        before_atoms = {atom.atomic_skill_id: atom for atom in source.atom_snapshot}
        after_atoms = {atom.atomic_skill_id: atom for atom in session.atom_snapshot}
        if (set(before_atoms) != set(after_atoms) or any(
                before_atoms[atom_id].model_dump() != atom.model_dump() for atom_id, atom in after_atoms.items())):
            return {**result, "status": "not_comparable", "reason": "双方目标原子定义或量规快照不同，不报告配对分差。"}
        grouped = {sid: {entry.atomic_skill_id: entry for entry in evidence if entry.session_id == sid}
                   for sid in (source.session_id, session.session_id)}
        if any(value.params.get("mode", "guided") == "guided" for value in (source, session)) or any(
                entry.assistance_used for entries in grouped.values() for entry in entries.values()):
            return {**result, "status": "assisted", "reason": "至少一方使用引导或辅助，只作学习参考，不报告独立表现差异。"}
        if any(set(entries) != set(after_atoms) or any(entry.status != "observed" or entry.score is None
                for entry in entries.values()) for entries in grouped.values()):
            return {**result, "status": "not_comparable", "reason": "缺少双方完整、无辅助且可观察的原子证据。"}
        paired = [{"atomic_skill_id": atom_id,
                   "baseline_score": grouped[source.session_id][atom_id].score,
                   "current_score": grouped[session.session_id][atom_id].score,
                   "difference": round(grouped[session.session_id][atom_id].score - grouped[source.session_id][atom_id].score, 2)}
                  for atom_id in after_atoms]
        return {**result, "status": "comparable", "reason": "双方均有同量规、无辅助的原子证据；分差仅描述这两次作答。", "atoms": paired}

    @staticmethod
    def _hypotheses(session: PracticeSession) -> list[dict]:
        scores = session.result.atomic_skill_scores if session.result else {}
        return [{"hypothesis_id": probe["probe_id"], "atomic_skill_id": probe["atomic_skill_id"],
                 "statement": PROBE_KEYS[probe["probe_id"]][1] + "（低分仅提出假设，尚不能归因）"}
                for probe in PROBES if scores.get(probe["atomic_skill_id"], 10) < 7]

    def _details(self, unit: UnitOfWork, session: PracticeSession) -> JsonObject:
        case = self._case(session)
        saved = unit.diagnoses.get(session.session_id, session.user_id)
        available = session.status == "completed"
        evidence = unit.progress.evidence(session.user_id) if available else []
        current_evidence = [entry for entry in evidence if entry.session_id == session.session_id]
        assistance_used = None
        if session.params.get("mode", "guided") == "guided":
            assistance_used = True
        elif {entry.atomic_skill_id for entry in current_evidence} == {
                atom.atomic_skill_id for atom in session.atom_snapshot}:
            assistance_used = any(entry.assistance_used for entry in current_evidence)
        diagnosis = {"status": "completed" if saved else "available" if available else "unavailable",
                     "message": "三个规则探针只检查公式、分母与可比性；不能判定完整错误原因。" if available else "完成作答后才能进行诊断。",
                     "probes": saved["probes"] if saved else deepcopy(PROBES) if available else [],
                     "hypotheses": saved["hypotheses"] if saved else self._hypotheses(session) if available else [],
                     "result": saved["result"] if saved else None}
        return {"session_id": session.session_id, "status": session.status, "case": case,
                "source_session_id": session.params.get("source_session_id"),
                "assistance_used": assistance_used,
                "comparison": self._comparison(unit, session, evidence), "diagnosis": diagnosis}

    def details(self, user_id: str, session_id: str) -> JsonObject:
        with self._work.read() as unit:
            return self._details(unit, unit.practices.get(session_id, user_id))

    def diagnose(self, user_id: str, session_id: str, answers: dict[str, str]) -> JsonObject:
        # The write scope serializes duplicate submissions; no model call or score
        # update occurs here, and the complete diagnostic snapshot is retained.
        with self._work.write() as unit:
            session = unit.practices.get(session_id, user_id)
            case = self._case(session)
            if session.status != "completed" or session.result is None:
                raise AppError("请先完成本次练习再进行诊断。", 409, "diagnosis_requires_completion")
            saved = unit.diagnoses.get(session_id, user_id)
            if saved:
                if saved["result"]["answers"] != answers:
                    raise AppError("该诊断已提交其他选择；请开始新练习后再诊断。", 409, "diagnosis_answer_conflict")
                return self._details(unit, session)
            if set(answers) != {probe["probe_id"] for probe in PROBES} or any(
                    answers[probe["probe_id"]] not in {option["option_id"] for option in probe["options"]}
                    for probe in PROBES):
                raise AppError("请为全部三个诊断问题选择一个有效选项。", 422, "invalid_diagnosis_answers")
            suspected = {hypothesis["hypothesis_id"] for hypothesis in self._hypotheses(session)}
            findings = []
            for probe in PROBES:
                probe_id = probe["probe_id"]
                correct_key, _, explanation = PROBE_KEYS[probe_id]
                correct = answers[probe_id] == correct_key
                status = ("refuted" if correct else "supported") if probe_id in suspected else "insufficient"
                qualification = ("本探针支持该假设，但不足以确认原答案的原因。" if status == "supported" else
                                 "本探针未支持该假设；答对不能排除作答时出现其他问题。" if status == "refuted" else
                                 "本次没有对应低分假设，单个探针不足以归因。")
                findings.append({"hypothesis_id": probe_id, "atomic_skill_id": probe["atomic_skill_id"],
                                 "status": status, "correct": correct, "explanation": explanation + qualification})
            knowledge = {item.knowledge_id: item for item in unit.skills.catalog_knowledge()}
            suggested_ids = {finding["atomic_skill_id"] for finding in findings if not finding["correct"]}
            suggested_ids.update(hypothesis["atomic_skill_id"] for hypothesis in self._hypotheses(session))
            needs_review = bool(suggested_ids)
            if not suggested_ids:
                suggested_ids = set(TARGETS)
            recommendations = [{"atomic_skill_id": atom.atomic_skill_id, "knowledge_ids": atom.knowledge_ids,
                "courses": list(dict.fromkeys(knowledge[key].course for key in atom.knowledge_ids if key in knowledge)),
                "reason": ("回看此原子的输入、交付标准与对应知识，再做一次引导基线；引导结果不作独立表现比较。" if needs_review
                           else "可继续综合交付，在完整便笺中复用此原子；诊断答对不等于已经掌握。"),
                "practice": {"skill_id": "t_conversion", "params": {
                    "bridge_case_id": "conversion_baseline" if needs_review else "conversion_synthesis",
                    "mode": "guided" if needs_review else "independent", "target_atomic_ids": TARGETS}}}
                for atom in session.atom_snapshot if atom.atomic_skill_id in suggested_ids]
            stamp = utc_now()
            result = {"answers": answers, "findings": findings, "recommendations": recommendations,
                      "limitations": ["固定三题只检查公式、分母与可比性，不覆盖所有错误原因。", "诊断选择不写入掌握分，不作为迁移证据。"], "submitted_at": stamp}
            unit.diagnoses.add(session_id, user_id, {"version": 1, "source_session_id": session.params.get("source_session_id"),
                "case_snapshot": case, "probes": deepcopy(PROBES), "hypotheses": self._hypotheses(session), "result": result}, stamp)
            return self._details(unit, session)
