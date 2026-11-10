"""Developer-authored, inspectable SQL/data-analysis teaching cases, not industry certification."""
from .models import AtomicSkill, PracticeContent, Skill
from .projects import Intervention

CASE_TASK_ID = "task_sql_grain_v1"
GRAIN = "sql_grain_v1"
JOIN = "sql_join_v1"
CHECK = "sql_check_v1"

ATOMS = [
    AtomicSkill(atomic_skill_id=GRAIN, name="识别统计粒度", description="区分订单和退款记录的行粒度与目标统计口径。",
        action="说明每张表一行代表什么，以及目标金额的统计范围", input_spec="订单及退款表与统计要求", output_spec="粒度、主键与口径说明",
        boundary="仅教学模拟，不推广为所有业务的财务定义", rubric=["区分一笔订单与一笔退款", "明确净收入计算范围"], contexts=["订单数据分析"]),
    AtomicSkill(atomic_skill_id=JOIN, name="判断连接重复累计", description="识别一对多连接对聚合的影响，并提出有效替代方案。",
        action="解释连接后重复的金额，选择正确统计策略", input_spec="一对多订单及退款数据", output_spec="连接风险及处理方案",
        boundary="预聚合、分别求和、适当子查询均可，不要求唯一SQL写法", rubric=["识别同订单多退款导致订单金额重复", "采用不重复累计的有效方法"],
        prerequisite_ids=[GRAIN], contexts=["订单数据分析"]),
    AtomicSkill(atomic_skill_id=CHECK, name="独立核验净收入", description="根据原始行独立核对净收入和边界情况。",
        action="计算订单总额减退款总额，并提出核验", input_spec="给定完整数据", output_spec="数值、算式与检查方法",
        boundary="只核验给定教学口径，不处理税费或未提供的业务假设", rubric=["结果与给定口径一致", "核对订单与退款合计，考虑无退款订单"],
        prerequisite_ids=[GRAIN], contexts=["订单数据分析"]),
]
SKILL = Skill(skill_id=CASE_TASK_ID, name="SQL连接与净收入核验", display_name="从数据库知识到订单分析",
    description="教学模拟：识别一对多连接风险并核对净收入。", atomic_skills=[GRAIN, JOIN, CHECK],
    context="订单数据分析", task_brief="核对订单与退款，解释口径并给出不重复累计的方案。", deliverable="净收入数值、计算思路和连接风险说明")

# Numeric expectations are derived from source rows, not supplied by a model.
CASES = [
    ([("A01", 120), ("A02", 80), ("A03", 200)], [("A01", 20), ("A01", 10), ("A03", 30)]),
    ([("B11", 90), ("B12", 150), ("B13", 60)], [("B12", 15), ("B12", 25), ("B13", 10)]),
    ([("C21", 160), ("C22", 160), ("C23", 80)], [("C21", 10), ("C21", 20), ("C23", 5)]),
    ([("D31", 210), ("D32", 70), ("D33", 110)], [("D31", 30), ("D31", 20), ("D32", 10)]),
    ([("E41", 180), ("E42", 180), ("E43", 50)], [("E42", 20), ("E42", 15), ("E43", 5)]),
]

def case_content(index: int) -> tuple[PracticeContent, float]:
    orders, refunds = CASES[index]
    expected = float(sum(value for _, value in orders) - sum(value for _, value in refunds))
    materials = ("教学模拟，金额单位：元。统计窗口已对齐；只计算所列订单及退款，不考虑税费。\n"
        "orders(order_id唯一, amount)：\n" + "\n".join(f"{key} | {value}" for key, value in orders) +
        "\nrefunds(order_id可重复, refund_amount)：\n" + "\n".join(f"{key} | {value}" for key, value in refunds))
    return PracticeContent(title=f"订单分析 · 案例 {index + 1}", description="计算净收入（订单金额合计减退款金额合计）。简述两表的行粒度，说明连接后的重复风险和可行处理方式，并给出一个检查方法。可用自然语言、算式或SQL，接受有效替代方案。",
        materials=materials, category=SKILL.name, difficulty="入门", target_atomic_ids=SKILL.atomic_skills), expected

HELP = {
    GRAIN: {
        "hint": ("先确定一行代表什么", "订单表一行是一笔订单；退款表中同一订单可以有多次退款。先区分两种粒度，再考虑连接。"),
        "explain": ("行数变化，不等于收入变化", "连接可能把一笔订单复制成多行。先写下每张表的主键和行含义；金额应在哪个粒度求和，需要由统计口径决定。"),
        "micro": ("只练粒度判断", "先分别标记两张表每行代表的对象，再判断哪张表可出现重复订单ID。"),
    },
    JOIN: {
        "hint": ("留意同一笔订单出现几次", "如果一笔订单匹配两条退款，它的订单金额会在连接结果出现两次。聚合前先确认这个倍增。"),
        "explain": ("避免连接后的重复累计", "可以先按订单汇总退款，再与唯一订单表左连接；也可以在一致口径下分别求订单总额与退款总额后相减。不能只对订单金额SUM(DISTINCT)：不同订单可能恰好同金额。"),
        "micro": ("用两行看清倍增", "一笔100元订单有10元和20元两条退款。直接连接后SUM(订单金额)-SUM(退款)会得到170，真实净收入为70。"),
    },
    CHECK: {
        "hint": ("先做一个独立合计", "暂时不依赖连接结果，分别把原始订单和退款求和，再检查差值，并留意没有退款的订单。"),
        "explain": ("用原始数据检查查询结果", "净收入基准等于原订单金额合计减原退款金额合计。检查是否丢失无退款订单、订单金额是否重复，退款是否重复计入。这个基准只适用于题目明确的统计窗口。"),
        "micro": ("只做一次金额核验", "订单为100元、100元、50元，退款为10元、20元。分别求两个合计，再计算差值；两笔同额订单都要保留。"),
    },
}

def case_help(atom_id: str, level: str) -> Intervention:
    title, text = HELP[atom_id][level]
    return Intervention(level=level, title=title, text=text,
        exercise="用自己的话说明刚才最容易出错的环节。答案可在下次新任务中检验。" if level == "micro" else "",
        source="内置教学示例；计算规则可核验，专业有效性仍需教师审核。")
