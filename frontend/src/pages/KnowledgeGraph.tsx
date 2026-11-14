import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { careerApi, projectApi } from "../lib/api";
import type { EvidenceData, GraphData, GraphNode } from "../types";
import { statusLabels, statusColors, statusSymbols } from "../lib/evidence";
import {
  PageHeading,
  Notice,
  LoadingState,
  SectionHeading,
} from "../components/workspace/Primitives";
import { Search, ArrowUpRight } from "lucide-react";
import KnowledgeGraphCanvas from "../components/KnowledgeGraphCanvas";
import { graphNodeStyles, graphRelationLabels } from "../lib/graphLayout";
import type { Project } from "../types/projects";
import { projectStatus } from "../types/projects";
import type { ProjectGraphPlan } from "../types/goalGraph";
import { useAccount } from "../hooks/useAccount";
import EvidenceTimeline from "../components/EvidenceTimeline";
import "../components/goalGraph.css";
const labels = Object.fromEntries(Object.entries(graphNodeStyles).map(([key, style]) => [key, style.label]));
const colors = Object.fromEntries(Object.entries(graphNodeStyles).map(([key, style]) => [key, style.color]));
const relations = graphRelationLabels;
export default function KnowledgeGraph() {
  const [params] = useSearchParams();
  const { account } = useAccount();
  const projectId = params.get("project") || "";
  return <KnowledgeGraphView key={`${account.user_id}:${projectId}`} projectId={projectId} userId={account.user_id} />;
}

function KnowledgeGraphView({ projectId, userId }: { projectId: string; userId: string }) {
  const [plan, setPlan] = useState<ProjectGraphPlan | null>(null);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState("");
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [error, setError] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");
  const [course, setCourse] = useState("");
  const [type, setType] = useState("");
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("node");

  useEffect(() => {
    let active = true;
    const graphRequest = projectId
      ? careerApi.projectGraph(projectId).then(value => { if (active) { setPlan(value); setGraph(value.graph); } })
      : careerApi.graph().then(value => { if (active) setGraph(value); });
    graphRequest
      .catch((error) => {
        if (active) setError(error.message);
      });
    if (!projectId) careerApi
      .evidence()
      .then((value) => {
        if (active) setEvidence(value);
      })
      .catch((error) => {
        if (active) setEvidenceError(error.message);
      });
    projectApi.list().then(value => { if (active) { setProjects(value.projects); setProjectsError(""); } })
      .catch(failure => { if (active) setProjectsError(failure.message); });
    return () => { active = false; };
  }, [projectId, revision]);

  const scopedNodes = useMemo(() => {
    if (!graph) return [];
    let allowed: Set<string> | null = null;

    if (role) {
      const tasks = graph.tasks.filter((task) => task.role_id === role);
      const atoms = new Set(tasks.flatMap((task) => task.atomic_skills));
      if (plan && tasks.length) {
        for (const atomId of plan.prerequisite_atom_ids) atoms.add(atomId);
      }
      const knowledge = new Set(
        graph.atoms
          .filter((atom) => atoms.has(atom.atomic_skill_id))
          .flatMap((atom) => atom.knowledge_ids),
      );
      allowed = new Set([
        `role:${role}`,
        ...tasks.map((task) => `task:${task.skill_id}`),
        ...Array.from(atoms, (id) => `atom:${id}`),
        ...Array.from(knowledge, (id) => `knowledge:${id}`),
      ]);
    }

    if (course) {
      const knowledge = graph.knowledge.filter(
        (item) => item.course === course,
      );
      const knowledgeIds = new Set(knowledge.map((item) => item.knowledge_id));
      const atoms = graph.atoms.filter((atom) =>
        atom.knowledge_ids.some((id) => knowledgeIds.has(id)),
      );
      const atomIds = new Set(atoms.map((atom) => atom.atomic_skill_id));
      const tasks = graph.tasks.filter((task) =>
        task.atomic_skills.some((id) => atomIds.has(id)),
      );
      const courseAllowed = new Set([
        ...knowledge.map((item) => `knowledge:${item.knowledge_id}`),
        ...atoms.map((atom) => `atom:${atom.atomic_skill_id}`),
        ...tasks.map((task) => `task:${task.skill_id}`),
        ...tasks.map((task) => `role:${task.role_id}`),
      ]);
      allowed = allowed
        ? new Set([...allowed].filter((id) => courseAllowed.has(id)))
        : courseAllowed;
    }

    return graph.nodes.filter(node => !allowed || allowed.has(node.id));
  }, [graph, role, course, plan]);

  const filtered = useMemo(() => scopedNodes.filter(node =>
    (!type || node.type === type) && `${node.label} ${node.description}`.toLowerCase().includes(query.trim().toLowerCase()),
  ), [scopedNodes, type, query]);
  const matchingIds = new Set(filtered.map(node => node.id));
  // Keep direct context around search matches so filtering an atom does not erase its knowledge/task links.
  const contextIds = new Set(matchingIds);
  if (query.trim() || type) {
    for (const edge of graph?.edges || []) {
      if (matchingIds.has(edge.source)) contextIds.add(edge.target);
      if (matchingIds.has(edge.target)) contextIds.add(edge.source);
    }
  }
  const canvasNodes = scopedNodes.filter(node => contextIds.has(node.id));
  const selected = scopedNodes.find(node => node.id === selectedId);
  const neighborhood = selected && graph
    ? graph.edges.filter(edge => edge.source === selected.id || edge.target === selected.id) : [];
  const select = (node: GraphNode) => {
    if (!scopedNodes.some(item => item.id === node.id)) { setRole(""); setCourse(""); }
    if (!canvasNodes.some(item => item.id === node.id)) { setQuery(""); setType(""); }
    setParams(previous => { const next = new URLSearchParams(previous); next.set("node", node.id); return next; });
  };
  const clearNode = () => setParams(previous => { const next = new URLSearchParams(previous); next.delete("node"); return next; });
  const atom = graph?.atoms.find(
    (item) =>
      selected?.type === "atom" &&
      item.atomic_skill_id === selected.reference_id,
  );
  const personal = evidence?.atomic_skills.find(
    (item) => item.atomic_skill_id === atom?.atomic_skill_id,
  );
  const personalContexts = plan
    ? plan.states.filter(state => state.atomic_skill_id === atom?.atomic_skill_id)
    : personal?.contexts || [];
  const relatedTasks =
    graph?.tasks.filter((task) =>
      atom
        ? task.atomic_skills.includes(atom.atomic_skill_id)
        : selected?.type === "task" && task.skill_id === selected.reference_id,
    ) || [];

  return (
    <div className="page-stack page-stack-wide graph-page">
      <PageHeading
        eyebrow="CAPABILITY MAP"
        title="看清知识与行动的连接"
        description="把职业、任务、行动与知识放在一张图里。拖动节点整理连接，点击节点回看条件、证据和练习入口。"
      />
      <section className="goal-controls" aria-label="图谱目标选择">
        <label>查看范围 <select aria-label="选择学习项目" value={projectId} onChange={event => {
          const next = new URLSearchParams(); if (event.target.value) next.set("project", event.target.value); setParams(next);
        }}><option value="">全部能力关系</option>{projectId && !projects?.some(item => item.project_id === projectId) && <option value={projectId}>当前项目</option>}{projects?.map(item => <option key={item.project_id} value={item.project_id}>{item.goal}</option>)}</select></label>
        <Link className="goal-text-link" to="/projects">管理学习目标 →</Link>
        <button className="goal-button" type="button" onClick={() => { setError(""); setEvidenceError(""); setRevision(value => value + 1); }}>刷新证据与图谱</button>
        {projectsError && <p role="alert">目标列表暂不可用：{projectsError}</p>}
      </section>
      {plan && <section className="goal-summary">
        <div className="goal-meta"><span>目标图谱</span><span>{plan.context || "待选择练习范围"}</span><span>{projectStatus[plan.status as keyof typeof projectStatus] || plan.status}</span></div>
        <h2>{plan.goal}</h2><p>{plan.scope_note}</p>
        {plan.task_id && <p>目标原子 {plan.target_atom_ids.length} 个 · 前置原子 {plan.prerequisite_atom_ids.length} 个 · 同情境最新记录有独立证据 {plan.states.filter(state => plan.target_atom_ids.includes(state.atomic_skill_id) && state.status === "independent").length}/{plan.target_atom_ids.length}（按 ID 汇总，非掌握率）</p>}
        {!plan.task_id && <p className="goal-empty">目标尚未绑定任务，先选择适用的练习范围，再查看所需能力。</p>}
        <div className="goal-project-links"><Link className="goal-text-link" to={`/projects/${encodeURIComponent(plan.project_id)}`}>回到项目继续学习 →</Link><a className="goal-text-link" href="#graph-node-details">查看节点与证据 ↓</a></div>
        {plan.recommendations.length > 0 && (
          <div className="goal-recommendations">
            {plan.recommendations.map(item => {
              const targetNames = item.target_atomic_ids.map(atomId =>
                plan.graph.atoms.find(atom => atom.atomic_skill_id === atomId)?.name || atomId,
              );
              return (
                <article key={item.skill_id}>
                  <h3>{item.title}</h3>
                  <p>{item.reason}</p>
                  <p>关注：{targetNames.join("、")}</p>
                  <Link
                    className="goal-text-link"
                    to={`/practice/${encodeURIComponent(item.skill_id)}?mode=independent&atoms=${encodeURIComponent(item.target_atomic_ids.join(","))}`}
                  >
                    独立尝试 →
                  </Link>
                </article>
              );
            })}
          </div>
        )}
        {plan.warnings.length > 0 && <details><summary>定义来源与比较边界 · {plan.warnings.length} 条说明</summary><ul>{plan.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details>}
      </section>}
      <div className="library-toolbar graph-toolbar">
        <div className="library-search">
          <Search size={16} />
          <input
            aria-label="搜索图谱节点"
            placeholder="搜索行动、任务或知识"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              clearNode();
            }}
          />
        </div>
        <select
          aria-label="职业筛选"
          className="p-3 border rounded-lg bg-card"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            clearNode();
          }}
        >
          <option value="">全部职业</option>
          {graph?.roles.map((item) => (
            <option key={item.role_id} value={item.role_id}>
              {item.name}
            </option>
          ))}
        </select>
        <select
          aria-label="课程筛选"
          className="p-3 border rounded-lg bg-card"
          value={course}
          onChange={(e) => {
            setCourse(e.target.value);
            clearNode();
          }}
        >
          <option value="">全部课程</option>
          {Array.from(new Set(graph?.knowledge.map((item) => item.course))).map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </select>
        <select
          aria-label="节点类型"
          className="p-3 border rounded-lg bg-card"
          value={type}
          onChange={(e) => {
            setType(e.target.value);
            clearNode();
          }}
        >
          <option value="">全部类型</option>
          {Object.entries(labels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        {selectedId && (
          <button className="text-primary" onClick={clearNode}>
            回到筛选概览
          </button>
        )}
      </div>
      {error && (
        <Notice
          onRetry={() => {
            setError("");
            setEvidenceError("");
            setRevision((v) => v + 1);
          }}
        >
          {error}
        </Notice>
      )}
      {!graph && !error && <LoadingState label="正在读取能力关系…" />}
      {evidenceError && (
        <p role="alert">
          个人证据暂不可用：{evidenceError}。图谱定义仍可浏览。
        </p>
      )}
      {graph && (
        <>
          <div className="graph-legend">
            {Object.entries(labels).map(([key, label]) => (
              <span
                key={key}
                style={{ color: colors[key as keyof typeof colors] }}
              >
                ● {label}
              </span>
            ))}
          </div>
          {plan?.task_id && <div className="goal-state-legend"><span>◎ 目标原子 · 虚线外圈为前置原子</span>{Object.entries(statusLabels).map(([key, label]) => <span key={key} style={{ color: statusColors[key as keyof typeof statusColors] }}>{statusSymbols[key as keyof typeof statusSymbols]} {label}</span>)}</div>}
          <KnowledgeGraphCanvas key={`${userId}:${projectId || "all"}`} storageKey={`flash-graph-view:${userId}:${projectId || "all"}`} plan={plan} graph={graph} nodes={canvasNodes} matchingIds={matchingIds}
            selectedId={selected?.id} evidence={evidence} onSelect={select} />
          {(query.trim() || type) && <p className="network-search-note">匹配 {filtered.length} 个节点，同时保留其直接关联节点作为上下文；职业与课程范围仍按筛选限制。</p>}
          <div className="graph-details-layout">
            <section className="panel graph-node-panel">
              <SectionHeading title={`全部匹配节点 · ${filtered.length}`} />
              {!filtered.length && <p>{plan && !plan.task_id ? "目标尚未绑定任务。" : "没有匹配节点，请调整筛选。"}</p>}
              <div className="graph-node-list">
                {filtered.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => select(node)}
                    aria-pressed={node.id === selected?.id}
                    className={`graph-list-node ${node.id === selected?.id ? "selected" : ""}`}
                  >
                    <span
                      className="graph-node-type"
                      style={{ color: colors[node.type] }}
                    >
                      {labels[node.type]}
                    </span>
                    <span>{node.label}</span>
                    <ArrowUpRight size={14} />
                  </button>
                ))}
              </div>
            </section>
            <section
              id="graph-node-details"
              className="panel graph-detail-panel space-y-4"
              aria-live="polite"
            >
              {selected ? (
                <>
                  <p className="text-primary">{labels[selected.type]}</p>
                  <h2 className="text-2xl font-bold">{selected.label}</h2>
                  <p>{selected.description}</p>
                  {selected.type === "knowledge" && (
                    <p className="text-sm text-primary">
                      课程：
                      {
                        graph.knowledge.find(
                          (item) => item.knowledge_id === selected.reference_id,
                        )?.course
                      }
                    </p>
                  )}
                  {atom && (
                    <>
                      <dl className="space-y-2">
                        <div>
                          <dt className="font-medium">行动</dt>
                          <dd>{atom.action}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">输入</dt>
                          <dd>{atom.input_spec}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">输出</dt>
                          <dd>{atom.output_spec}</dd>
                        </div>
                        <div>
                          <dt className="font-medium">适用边界</dt>
                          <dd>{atom.boundary}</dd>
                        </div>
                      </dl>
                      <div className="grid sm:grid-cols-2 gap-3">
                        {(
                          [
                            ["触发线索", atom.trigger_conditions],
                            ["适用条件", atom.applicability_conditions],
                            ["常见误用", atom.common_misuses],
                            ["需要澄清的情况", atom.clarification_conditions],
                          ] as const
                        ).map(([title, conditions]) => (
                          <section key={title} className="condition-panel">
                            <h3 className="font-semibold">{title}</h3>
                            {conditions?.length ? (
                              <ul className="list-disc pl-5 space-y-1">
                                {conditions.map((condition) => (
                                  <li key={condition}>{condition}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                本定义尚未补充。
                              </p>
                            )}
                          </section>
                        ))}
                      </div>
                      <h3 className="font-semibold">可观察评分依据</h3>
                      <ul className="list-disc pl-5 space-y-1">
                        {atom.rubric.map((item) => (
                          <li key={item}>{item}</li>
                        ))}
                      </ul>
                      <p className="text-sm text-muted-foreground">
                        定义版本 {atom.version} · 情境：
                        {atom.contexts.join("、")}
                      </p>
                      <h3 className="font-semibold">我的情境证据</h3>
                      {!plan && !evidence && (
                        <p>
                          {evidenceError ? "证据无法加载" : "正在加载证据…"}
                        </p>
                      )}
                      {personalContexts.map((item) => (
                        <p key={item.context}>
                          {item.context}：{statusLabels[item.status]} ·{" "}
                          {item.evidence_count} 条证据
                          {item.last_score != null
                            ? ` · 最近评分 ${item.last_score}`
                            : " · 未换算分数"}
                        </p>
                      ))}
                      {personal && !plan && (
                        <p>
                          {personal.transfer_observed
                            ? "已有跨情境观察"
                            : "尚无跨情境证据"}
                        </p>
                      )}
                      <EvidenceTimeline key={`${atom.atomic_skill_id}:${revision}`} atomicSkillId={atom.atomic_skill_id} context={plan?.context || undefined} projectId={projectId || undefined} />
                    </>
                  )}
                  <h3 className="font-semibold">直接关系</h3>
                  {neighborhood.length === 0 && <p>暂无直接关系。</p>}
                  {neighborhood.map((edge, index) => {
                    const source = graph.nodes.find(
                      (node) => node.id === edge.source,
                    );
                    const target = graph.nodes.find(
                      (node) => node.id === edge.target,
                    );
                    return (
                      <p key={index} className="text-sm">
                        <button
                          className="text-primary"
                          onClick={() => source && select(source)}
                        >
                          {source?.label}
                        </button>{" "}
                        → {relations[edge.relation]} →
                        <button
                          className="text-primary"
                          onClick={() => target && select(target)}
                        >
                          {target?.label}
                        </button>
                      </p>
                    );
                  })}
                  {relatedTasks.length > 0 && (
                    <>
                      <h3 className="font-semibold">在任务中练习</h3>
                      {relatedTasks.map((task) => (
                        <div
                          key={task.skill_id}
                          className="border-t pt-3 space-y-2"
                        >
                          <p>
                            {task.display_name} · {task.context}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            交付物：{task.deliverable}
                          </p>
                          <div className="flex flex-wrap gap-3">
                            {plan ? <Link className="text-primary text-sm" to={`/projects/${encodeURIComponent(plan.project_id)}`}>按项目保存的任务继续学习 →</Link> : ["guided", "independent", "transfer"].map(
                              (mode, index) => (
                                <Link
                                  key={mode}
                                  className="text-primary text-sm"
                                  to={`/practice/${encodeURIComponent(task.skill_id)}?mode=${mode}${atom ? `&atoms=${encodeURIComponent(atom.atomic_skill_id)}` : ""}`}
                                >
                                  {["引导", "独立", "迁移"][index]}练习 →
                                </Link>
                              ),
                            )}
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              ) : (
                <div className="network-detail-empty"><span>从一个连接开始</span><h2>点击图中的节点</h2><p>查看它的适用条件、前置能力与原始作答证据，再决定下一步练什么。拖动仅调整布局，不改变知识关系。</p></div>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
