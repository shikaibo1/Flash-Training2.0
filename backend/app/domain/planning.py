"""Reviewable project-local curriculum; proposed definitions are not learner evidence."""
from typing import Literal
from pydantic import ConfigDict, Field, model_validator
from .models import Model, AtomicSkill, Skill
from .catalog import KnowledgeConcept


class PlanModel(Model):
    model_config = ConfigDict(extra='forbid', frozen=True, str_strip_whitespace=True)


class PlanModule(PlanModel):
    key: str = Field(pattern=r'^[a-z][a-z0-9_]{0,31}$')
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(min_length=1, max_length=1000)


class PlanAtom(PlanModel):
    key: str = Field(pattern=r'^[a-z][a-z0-9_]{0,31}$')
    module_key: str = Field(pattern=r'^[a-z][a-z0-9_]{0,31}$')
    name: str = Field(min_length=1, max_length=100)
    action: str = Field(min_length=1, max_length=1000)
    input_spec: str = Field(min_length=1, max_length=1500)
    output_spec: str = Field(min_length=1, max_length=1500)
    boundary: str = Field(min_length=1, max_length=1500)
    rubric: list[str] = Field(min_length=1, max_length=4)
    prerequisite_keys: list[str] = Field(default_factory=list, max_length=5)
    diagnostic_question: str = Field(min_length=1, max_length=500)
    basis: Literal['user_material', 'proposal'] = 'proposal'
    source_quote: str = Field(default='', max_length=1000)
    applicability_conditions: list[str] = Field(min_length=1, max_length=3)
    common_misuses: list[str] = Field(min_length=1, max_length=3)

    @model_validator(mode='after')
    def meaningful_items(self):
        for items in (self.rubric, self.applicability_conditions, self.common_misuses):
            if any(not item.strip() or len(item) > 1500 for item in items):
                raise ValueError('评价标准、条件和误用须为非空短句')
        if (self.basis == 'user_material') != bool(self.source_quote.strip()):
            raise ValueError('资料依据须有引用；补充建议不能冒充资料原文')
        return self


class LearningPlan(PlanModel):
    disposition: Literal['ready', 'needs_clarification']
    title: str = Field(min_length=2, max_length=180)
    scope: str = Field(min_length=1, max_length=2000)
    context: str = Field(min_length=1, max_length=160)
    deliverable: str = Field(min_length=1, max_length=2000)
    exclusions: str = Field(min_length=1, max_length=1500)
    questions: list[str] = Field(default_factory=list, max_length=2)
    modules: list[PlanModule] = Field(default_factory=list, max_length=3)
    atoms: list[PlanAtom] = Field(default_factory=list, max_length=6)

    @model_validator(mode='after')
    def coherent_graph(self):
        if any(not q.strip() or len(q) > 500 for q in self.questions):
            raise ValueError('澄清问题须为非空短句')
        if self.disposition == 'needs_clarification':
            if not self.questions or self.modules or self.atoms:
                raise ValueError('需澄清时只返回一至两个问题，不预造原子')
            return self
        if self.questions or not self.modules or not 2 <= len(self.atoms) <= 6:
            raise ValueError('可用方案需要模块和二至六个可观察原子，不包含待答问题')
        modules = {m.key for m in self.modules}
        atoms = {a.key: a for a in self.atoms}
        if len(modules) != len(self.modules) or len(atoms) != len(self.atoms):
            raise ValueError('模块或原子标识重复')
        if len({a.name.casefold() for a in self.atoms}) != len(self.atoms):
            raise ValueError('原子名称重复，请合并或澄清动作')
        used = set()
        for atom in self.atoms:
            used.add(atom.module_key)
            if atom.module_key not in modules:
                raise ValueError('原子必须属于已有模块')
            if len(set(atom.prerequisite_keys)) != len(atom.prerequisite_keys):
                raise ValueError('前置关系重复')
            if any(key not in atoms or key == atom.key for key in atom.prerequisite_keys):
                raise ValueError('前置原子不存在或引用自身')
        if used != modules:
            raise ValueError('每个模块至少需要一个原子')
        visited, visiting = set(), set()

        def visit(key):
            if key in visiting:
                raise ValueError('前置能力存在循环，请调整关系')
            if key in visited:
                return
            visiting.add(key)
            for previous in atoms[key].prerequisite_keys:
                visit(previous)
            visiting.remove(key)
            visited.add(key)
        for key in atoms:
            visit(key)
        return self


def check_sources(plan: LearningPlan, source_text: str) -> None:
    for atom in plan.atoms:
        if atom.basis == 'user_material' and atom.source_quote not in source_text:
            raise ValueError(f'「{atom.name}」的引用不在项目资料原文中，请核对')


def private_definitions(project_id: str, plan: LearningPlan):
    """Do not insert these into the public catalog or reuse IDs by name similarity."""
    ids = {a.key: f'personal_{project_id}_{a.key}' for a in plan.atoms}
    knowledge_ids = {m.key: f'personal_{project_id}_{m.key}' for m in plan.modules}
    atoms = [AtomicSkill(atomic_skill_id=ids[a.key], name=a.name, description=a.action,
        action=a.action, input_spec=a.input_spec, output_spec=a.output_spec, boundary=a.boundary,
        rubric=a.rubric, contexts=[plan.context], prerequisite_ids=[ids[k] for k in a.prerequisite_keys],
        knowledge_ids=[knowledge_ids[a.module_key]], applicability_conditions=a.applicability_conditions,
        common_misuses=a.common_misuses) for a in plan.atoms]
    task = Skill(skill_id=f'personal_task_{project_id}', name=plan.title, display_name=plan.title,
        description=plan.scope, context=plan.context, atomic_skills=list(ids.values()),
        task_brief=f'{plan.scope}\n范围外：{plan.exclusions}', deliverable=plan.deliverable)
    knowledge = [KnowledgeConcept(knowledge_id=knowledge_ids[m.key], name=m.name,
        description=m.description, course=plan.title) for m in plan.modules]
    return task, atoms, knowledge
