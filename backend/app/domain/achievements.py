"""Learning milestones celebrate observable actions, never certify lasting mastery."""
from typing import Literal
from pydantic import Field
from .models import Model


class Milestone(Model):
    id: str
    title: str
    description: str
    category: Literal['开始行动', '主动理解', '独立验证']
    icon: str
    target: int = 1
    action_label: str
    action_path: str
    rule_version: int = 1


CATALOG = (
    Milestone(id='first_goal', title='心有所向', description='保存第一个学习目标，给探索一个方向。', category='开始行动', icon='sprout', action_label='创建学习目标', action_path='/projects'),
    Milestone(id='first_task', title='迈出第一步', description='提交并完成一次任务评估；引导或独立尝试都算。', category='开始行动', icon='footprints', action_label='开始一次任务', action_path='/projects'),
    Milestone(id='five_tasks', title='步履不停', description='累计完成 5 次任务评估，不计诊断追问与重复提交。', category='开始行动', icon='route', target=5, action_label='继续练习', action_path='/skills'),
    Milestone(id='two_contexts', title='换个角度', description='在 2 个不同任务情境中完成尝试，拓宽观察；不代表已实现能力迁移。', category='开始行动', icon='compass', target=2, action_label='探索其他任务', action_path='/skills'),
    Milestone(id='first_probe', title='多想一步', description='回答一次诊断追问，让系统更了解你的思路。答错也算认真尝试。', category='主动理解', icon='message', action_label='继续学习目标', action_path='/projects'),
    Milestone(id='first_reflection', title='把思路说清', description='在项目的局部练习中提交一次自己的思考。', category='主动理解', icon='notebook', action_label='练习与反思', action_path='/projects'),
    Milestone(id='first_independent', title='独立起步', description='完成一次未声明辅助的独立任务或项目作答（追问除外），不要求得高分。', category='独立验证', icon='feather', action_label='独立尝试', action_path='/skills'),
    Milestone(id='three_atoms', title='证据成线', description='为 3 个不同原子留下独立支持证据。普通练习需可观察且单项至少 7/10；项目需明确支持，追问不计。', category='独立验证', icon='network', target=3, action_label='查看能力证据', action_path='/graph'),
    Milestone(id='first_retest', title='新题再试', description='完成一次未声明辅助的新材料项目复测；结果如何，都值得记录。', category='独立验证', icon='scan', action_label='继续项目复测', action_path='/projects'),
    Milestone(id='learning_loop', title='让理解落地', description='同一项目先发现缺口、获取帮助，再在新材料复测中为全部目标留下独立支持证据。仅纪念这次表现。', category='独立验证', icon='gem', action_label='完成学习闭环', action_path='/projects'),
)


class AchievementProof(Model):
    achieved_at: str
    source_path: str
    source_label: str


class AchievementAward(AchievementProof):
    achievement_id: str
    rule_version: int
    awarded_at: str
    seen_at: str | None = None


class AchievementProgress(Model):
    achievement_id: str
    count: int
    proof: AchievementProof | None = None


class AchievementItem(Milestone):
    progress: int
    unlocked: bool
    award: AchievementAward | None = None


class AchievementDashboard(Model):
    items: list[AchievementItem]
    unlocked_count: int
    total: int
    unread_ids: list[str]
    completed_tasks: int
    independent_tasks: int
    independent_atoms: int


class AchievementSeen(Model):
    ids: list[str] = Field(min_length=1, max_length=50)
