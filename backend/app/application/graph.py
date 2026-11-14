from ..domain.catalog import GraphEdge, GraphNode, GraphResponse, Role, KnowledgeConcept
from ..domain.models import AtomicSkill, Skill
from ..domain.ports import UnitOfWorkFactory
from ..domain.goal_graph import ProjectGraphPlan, GoalAtomState
from .evidence import _summarize, _context_state, recommend_tasks


class GraphService:
    def __init__(self, work: UnitOfWorkFactory):
        self._work = work

    def graph(self) -> GraphResponse:
        with self._work.read() as unit:
            roles = unit.skills.catalog_roles()
            knowledge = unit.skills.catalog_knowledge()
            atoms = unit.skills.atoms()
            tasks = unit.skills.list(enabled_only=True)
        return build_graph(roles, knowledge, atoms, tasks)

    def project_plan(self, user_id: str, project_id: str) -> ProjectGraphPlan:
        with self._work.read() as unit:
            project = unit.projects.get(project_id, user_id)
            roles = unit.skills.catalog_roles()
            knowledge = unit.skills.catalog_knowledge()
            catalog_atoms = unit.skills.atoms()
            tasks = unit.skills.list(enabled_only=True)
            evidence = unit.progress.evidence(user_id)
            observations = unit.projects.observations(user_id)
        if project.skill is None:
            return ProjectGraphPlan(project_id=project_id, goal=project.goal, context=None, task_id=None,
                status=project.status, scope_note=project.scope_note, graph=build_graph([], [], [], []),
                target_atom_ids=[], prerequisite_atom_ids=[], states=[], recommendations=[],
                warnings=['目标尚未绑定任务，请回到学习项目选择适用的练习范围。'])

        current = {a.atomic_skill_id: a for a in catalog_atoms}
        snapshots = {a.atomic_skill_id: a for a in project.atoms}
        definitions = {**current, **snapshots}
        targets = list(dict.fromkeys(project.skill.atomic_skills))
        warnings, included, finished = [], {}, set()
        # Iterative DFS bounds traversal and detects back edges without recursion depth limits.
        visiting = set()
        for target in targets:
            stack = [(target, False)]
            while stack:
                atom_id, leaving = stack.pop()
                if leaving:
                    visiting.discard(atom_id)
                    finished.add(atom_id)
                    continue
                if atom_id in visiting:
                    warnings.append(f'检测到前置关系循环：{atom_id}；关系仅供查看，不生成强制顺序。')
                    continue
                if atom_id in finished:
                    continue
                definition = definitions.get(atom_id)
                if definition is None:
                    warnings.append(f'前置或目标原子 {atom_id} 的定义缺失，未补造节点或推荐。')
                    finished.add(atom_id)
                    continue
                included[atom_id] = definition
                visiting.add(atom_id)
                stack.append((atom_id, True))
                stack.extend((prior_id, False) for prior_id in reversed(definition.prerequisite_ids))

        for definition in project.atoms:
            latest = current.get(definition.atomic_skill_id)
            if latest is None or latest != definition:
                warnings.append(f'「{definition.name}」按项目快照 v{definition.version} 展示；当前目录定义已变化或缺失。')
        for atom_id in targets:
            if atom_id not in snapshots and atom_id in current:
                warnings.append(f'目标原子 {atom_id} 未保存快照，本次仅展示当前目录定义，不能追认历史版本。')
        if not any(task == project.skill for task in tasks):
            warnings.append('项目绑定任务在当前目录已变化、停用或移除；原项目继续使用保存的定义，补练使用当前目录。')
        warnings.append('目标任务与目标原子沿用项目快照；其余前置、知识和职业引用当前目录。证据状态按原子 ID 与情境汇总，未逐条校验定义版本；请在时间线核对历史版本，不视为长期掌握或同条件提升。')
        knowledge_ids = {kid for a in included.values() for kid in a.knowledge_ids}
        known_knowledge = {k.knowledge_id for k in knowledge}
        for missing in sorted(knowledge_ids - known_knowledge):
            warnings.append(f'知识引用 {missing} 已缺失，未展示其连线。')
        if project.skill.role_id and not any(r.role_id == project.skill.role_id for r in roles):
            warnings.append('该项目的职业定义已缺失，目标任务仍可查看。')
        atoms = list(included.values())
        context = project.skill.context
        summaries = _summarize(atoms, evidence, observations)
        states = [GoalAtomState(atomic_skill_id=s.atomic_skill_id,
                  **_context_state(s, context).model_dump()) for s in summaries]
        # A suggestion opens today's catalog task. Only offer compatible current definitions.
        candidates = [task for task in tasks if task.context == context and task.atomic_skills
                      and set(task.atomic_skills) <= included.keys()
                      and all(current.get(aid) == included[aid] for aid in task.atomic_skills)]
        # Missing prerequisite references have already been warned about; do not feed them to the planner.
        planner_atoms = [a.model_copy(update={'prerequisite_ids': [pid for pid in a.prerequisite_ids if pid in included]})
                         for a in atoms]
        recommendations = recommend_tasks(planner_atoms, candidates, evidence, observations).recommendations
        if not recommendations:
            warnings.append('当前目录没有同情境且定义相符的补练任务，可回到原项目按已保存材料继续。')
        return ProjectGraphPlan(project_id=project_id, goal=project.goal, context=context,
            task_id=project.skill.skill_id, status=project.status, scope_note=project.scope_note,
            graph=build_graph([r for r in roles if r.role_id == project.skill.role_id],
                [k for k in knowledge if k.knowledge_id in knowledge_ids], atoms, [project.skill]),
            target_atom_ids=targets, prerequisite_atom_ids=[aid for aid in included if aid not in targets],
            states=states, recommendations=recommendations, warnings=list(dict.fromkeys(warnings)))


def build_graph(roles: list[Role], knowledge: list[KnowledgeConcept],
                atoms: list[AtomicSkill], tasks: list[Skill]) -> GraphResponse:
    nodes = []
    for kind, records, id_field in (("role", roles, "role_id"), ("knowledge", knowledge, "knowledge_id"),
                                     ("atom", atoms, "atomic_skill_id"), ("task", tasks, "skill_id")):
        for record in records:
            reference_id = getattr(record, id_field)
            label = record.display_name if kind == "task" else record.name
            nodes.append(GraphNode(id=f"{kind}:{reference_id}", type=kind, label=label,
                                   description=record.description, reference_id=reference_id))
    edges = []
    for task in tasks:
        if task.role_id:
            edges.append(GraphEdge(source=f"role:{task.role_id}", target=f"task:{task.skill_id}", relation="contains"))
        edges.extend(GraphEdge(source=f"task:{task.skill_id}", target=f"atom:{atom_id}", relation="requires")
                     for atom_id in task.atomic_skills)
    for atom in atoms:
        edges.extend(GraphEdge(source=f"knowledge:{knowledge_id}", target=f"atom:{atom.atomic_skill_id}", relation="supports")
                     for knowledge_id in atom.knowledge_ids)
        edges.extend(GraphEdge(source=f"atom:{prior_id}", target=f"atom:{atom.atomic_skill_id}", relation="prerequisite")
                     for prior_id in atom.prerequisite_ids)
    node_ids = {node.id for node in nodes}
    edges = [edge for edge in edges if edge.source in node_ids and edge.target in node_ids]
    return GraphResponse(nodes=nodes, edges=edges, atoms=atoms, tasks=tasks, roles=roles, knowledge=knowledge)
