"""Versioned teaching cases and small, deterministic diagnostic probes.

These materials control explicit differences; they make no claim of equal
difficulty, industrial validity, or causal proof of transfer.
"""
from __future__ import annotations
from copy import deepcopy
from ..errors import AppError
from .models import AgentStep, PracticeContent

TARGETS = ["a_extract", "a_metric", "a_compare"]
# Increment the family version whenever materials or controlled differences
# change in a way that invalidates pairing with earlier case snapshots.
COMPARISON_VERSION = 1
LIMITATIONS = ["教学模拟案例，未验证等难或行业效度。", "配对分差是描述性结果，不能证明迁移或变化的因果关系。", "案例复用数值，先前作答或看过示例可能产生记忆与练习效应。"]

_BASE_MATERIALS = """教学模拟；以下记录均为完整且去重的同周、同渠道新访客。
| 方案 | 新访客人数 | 完成购买人数 | 购买观察窗口 |
| A | 1000 | 80 | 首次访问后7天 |
| B | 800 | 72 | 首次访问后7天 |
来源记录编号分别为A、B；所有百分比保留1位小数。待核对声明：A为8.0%，B为9.0%。
购买转化率定义：在指定观察窗口内完成购买的新访客人数 / 新访客总人数。没有随机分组或显著性检验信息。"""
_EMAIL_MATERIALS = """教学模拟；业务邮件：本周同渠道去重后，来源记录A：A方案有1000名新访客，其中80人在首次访问后7天内购买；来源记录B：B方案有800名新访客，其中72人在首次访问后7天内购买。两组记录完整，窗口一致。所有百分比保留1位小数。待核对声明：A为8.0%，B为9.0%。购买转化率定义为指定观察窗口内购买的新访客人数除以新访客总人数。没有随机分组或显著性检验信息。"""
_BOUNDARY_MATERIALS = _BASE_MATERIALS.replace("| B | 800 | 72 | 首次访问后7天 |", "| B | 800 | 72 | 首次访问后30天 |")
_BRIEF = "你是运营分析助理。标明来源记录编号，提取A/B的访客数、购买数及窗口，写出公式、分母和计算过程，按精度要求核对声明值，比较转化率并说明比较前提。只依据材料，以文字交付；不要把观察差异写成因果或显著性结论。"
_EXAMPLE = "来源记录A：访客1000、购买80、窗口7天；来源记录B：访客800、购买72、窗口7天。转化率=购买新访客/全部新访客，A=80/1000=8.0%，B=72/800=9.0%，均与声明值一致，B观察值高1.0个百分点。窗口与渠道一致，可作描述性比较；缺少随机分组、样本结构和显著性信息，不能断言方案B造成提升。"


def _case(case_id, title, stage, changed, modes, source, materials, example, description=_BRIEF):
    return {"case_id": case_id, "version": 1, "comparison_version": COMPARISON_VERSION,
            "title": title, "stage": stage,
            "changed_condition": changed,
            "controlled_conditions": ["同一任务目标与三个目标原子", "复用同一原子量规", "A/B访客和购买数固定"],
            "target_atomic_ids": TARGETS, "allowed_modes": modes, "requires_source": source,
            "description": description, "materials": materials, "example_answer": example}


_CASES = {
    item["case_id"]: item for item in [
        _case("conversion_baseline", "基线：表格中的转化率", "baseline", "无：建立基线", ["guided", "independent"], False, _BASE_MATERIALS, _EXAMPLE),
        _case("conversion_representation", "表征变式：从邮件重建指标", "representation", "仅将表格改为业务邮件", ["transfer"], False, _EMAIL_MATERIALS, _EXAMPLE),
        _case("conversion_boundary", "边界变式：观察窗口不同", "boundary", "仅将B的购买窗口从7天改为30天", ["transfer"], False,
              _BOUNDARY_MATERIALS,
              "来源A：1000名新访客、80名购买者、7天窗口；来源B：800名新访客、72名购买者、30天窗口。转化率=购买新访客/全部新访客，A=80/1000=8.0%（7天），B=72/800=9.0%（30天），分别与声明一致。两组窗口不同，不能把1.0个百分点解释为同口径转化改善。应取得两组统一7天或统一30天的购买数后再比较；现有数据不能计算统一口径差异。"),
        _case("conversion_synthesis", "综合交付：给负责人写分析便笺", "synthesis", "增加交付组织与行动建议要求", ["guided", "independent"], False,
              _BASE_MATERIALS, _EXAMPLE + "建议先核对样本结构与分流方式，再设计统一口径的后续观察。",
              _BRIEF + "交付一份不超过600字的分析便笺，分为：1.事实清单；2.指标与计算；3.比较及局限；4.给负责人的建议和仍需收集的信息。评分仍仅覆盖三个目标原子，不额外评价写作风格。"),
    ]
}


def get_case(case_id: str) -> dict:
    if not isinstance(case_id, str) or case_id not in _CASES:
        raise AppError("受控案例不存在。", 422, "invalid_bridge_case")
    return deepcopy(_CASES[case_id])


def public_case(case: dict) -> dict:
    return {key: deepcopy(value) for key, value in case.items() if key not in ("materials", "example_answer")}


def catalog() -> dict:
    return {"skill_id": "t_conversion", "title": "从原子练习到工作交付", "description": "基线、表征变式、条件边界与综合交付；可自由选择步骤。",
            "limitations": LIMITATIONS, "cases": [public_case(case) for case in _CASES.values()]}


def fixed_content(case_id: str, category: str, difficulty: str) -> PracticeContent:
    case = get_case(case_id)
    return PracticeContent(title=case["title"], description=case["description"], materials=case["materials"],
        hint="先列数据及观察窗口，再确定分母、计算并检查可比条件。", example_answer=case["example_answer"],
        category=category, difficulty=difficulty, target_atomic_ids=TARGETS,
        agent_trace=[AgentStep(agent="controlled_case_selector", method="rule", summary=f"选择固定教学案例 {case_id} v{case['version']}；材料不由模型改写")])


PROBES = [
    {"probe_id": "formula", "atomic_skill_id": "a_metric", "question": "1000名新访客中80人购买，购买转化率的计算式是什么？",
     "options": [{"option_id": "purchase_over_visitors", "label": "80 / 1000"}, {"option_id": "visitors_over_purchase", "label": "1000 / 80"}, {"option_id": "purchase_over_nonpurchase", "label": "80 / 920"}]},
    {"probe_id": "denominator", "atomic_skill_id": "a_extract", "question": "计算B的新访客购买转化率，应使用哪个分母？",
     "options": [{"option_id": "buyers", "label": "72名购买者"}, {"option_id": "all_new_visitors", "label": "B的全部800名新访客"}, {"option_id": "both_groups", "label": "A与B合计1800名新访客"}]},
    {"probe_id": "comparability", "atomic_skill_id": "a_compare", "question": "A统计7天内购买，B统计30天内购买。应如何处理8%与9%的差异？",
     "options": [{"option_id": "b_wins", "label": "直接认定B提升了1个百分点"}, {"option_id": "equal_counts", "label": "只要访客人数相同就能比较"}, {"option_id": "align_window", "label": "先统一观察窗口，现有差异不能作为同口径提升"}]},
]
PROBE_KEYS = {
    "formula": ("purchase_over_visitors", "公式方向可能混淆", "购买转化率用购买的新访客数除以全部新访客数，80/1000=8%。"),
    "denominator": ("all_new_visitors", "指标分母或数据归属可能混淆", "B的新访客购买转化率分母是B的全部800名新访客。"),
    "comparability": ("align_window", "比较前提可能被忽略", "7天和30天窗口不一致，应取得相同观察窗口的数据后再比较。"),
}
