import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { careerApi } from "../lib/api";
import type { EvidenceData, GraphData, GraphNode } from "../types";
import { statusLabels } from "../lib/evidence";
import {
  PageHeading,
  Notice,
  LoadingState,
  SectionHeading,
} from "../components/workspace/Primitives";
import { Search, ArrowUpRight } from "lucide-react";
const labels = {
  role: "职业",
  task: "任务",
  atom: "原子能力",
  knowledge: "课程知识",
};
const colors = {
  role: "#526e60",
  task: "#6c8caa",
  atom: "#46846b",
  knowledge: "#b8955e",
};
const relations = {
  requires: "需要",
  supports: "支撑",
  prerequisite: "前置",
  contains: "包含",
};
export default function KnowledgeGraph() {
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
    careerApi
      .graph()
      .then((value) => {
        if (active) setGraph(value);
      })
      .catch((error) => {
        if (active) setError(error.message);
      });
    careerApi
      .evidence()
      .then((value) => {
        if (active) setEvidence(value);
      })
      .catch((error) => {
        if (active) setEvidenceError(error.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const filtered = useMemo(() => {
    if (!graph) return [];
    let allowed: Set<string> | null = null;

    if (role) {
      const tasks = graph.tasks.filter((task) => task.role_id === role);
      const atoms = new Set(tasks.flatMap((task) => task.atomic_skills));
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

    return graph.nodes.filter((node) => {
      const matchesScope = !allowed || allowed.has(node.id);
      const matchesType = !type || node.type === type;
      const matchesQuery = `${node.label} ${node.description}`
        .toLowerCase()
        .includes(query.toLowerCase());
      return matchesScope && matchesType && matchesQuery;
    });
  }, [graph, query, role, course, type]);

  // A focused neighborhood keeps the initial view readable; the list exposes all matches.
  const selected =
    graph?.nodes.find((node) => node.id === selectedId) ||
    filtered.find((node) => node.type === "role") ||
    filtered[0];
  const neighborhood =
    selected && graph
      ? graph.edges.filter(
          (edge) => edge.source === selected.id || edge.target === selected.id,
        )
      : [];
  const visible =
    selected && graph
      ? [
          selected,
          ...graph.nodes.filter(
            (node) =>
              node.id !== selected.id &&
              neighborhood.some(
                (edge) => edge.source === node.id || edge.target === node.id,
              ),
          ),
        ]
      : [];
  const visibleIds = new Set(visible.map((node) => node.id));
  const edges =
    graph?.edges.filter(
      (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
    ) || [];
  const neighbors = visible.filter((node) => node.id !== selected?.id);
  const left = neighbors.filter((_, index) => index % 2 === 0);
  const right = neighbors.filter((_, index) => index % 2 !== 0);
  const height = Math.max(320, Math.max(left.length, right.length) * 112 + 60);
  const position = (id: string) => {
    if (id === selected?.id) return { x: 440, y: height / 2 };
    const leftIndex = left.findIndex((node) => node.id === id);
    const group = leftIndex >= 0 ? left : right;
    const index =
      leftIndex >= 0 ? leftIndex : right.findIndex((node) => node.id === id);
    return {
      x: leftIndex >= 0 ? 145 : 735,
      y: height / 2 + (index - (group.length - 1) / 2) * 112,
    };
  };
  const select = (node: GraphNode) => setParams({ node: node.id });
  const atom = graph?.atoms.find(
    (item) =>
      selected?.type === "atom" &&
      item.atomic_skill_id === selected.reference_id,
  );
  const personal = evidence?.atomic_skills.find(
    (item) => item.atomic_skill_id === atom?.atomic_skill_id,
  );
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
        description="从职业任务回到支撑它的知识。选择一个节点，探索直接关系、评分依据和练习入口。"
      />
      <div className="library-toolbar graph-toolbar">
        <div className="library-search">
          <Search size={16} />
          <input
            aria-label="搜索图谱节点"
            placeholder="搜索行动、任务或知识"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setParams({});
            }}
          />
        </div>
        <select
          aria-label="职业筛选"
          className="p-3 border rounded-lg bg-card"
          value={role}
          onChange={(e) => {
            setRole(e.target.value);
            setParams({});
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
            setParams({});
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
            setParams({});
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
          <button className="text-primary" onClick={() => setParams({})}>
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
          <section className="graph-canvas" aria-label="可交互关系图">
            <p className="p-2 text-sm text-muted-foreground">
              {selected
                ? `${selectedId ? "" : "当前概览："}${selected.label} 的直接关系（${visible.length} 个节点）；筛选列表含 ${filtered.length} 个匹配节点。`
                : `筛选到 ${filtered.length} 个节点，概览显示前 ${visible.length} 个；下方列表包含全部匹配结果。`}
            </p>
            <svg
              viewBox={`0 0 880 ${height}`}
              style={{ minWidth: 620, width: "100%" }}
              role="img"
              aria-label="职业能力关系图，亦可使用下方节点列表"
            >
              <defs>
                <marker
                  id="graph-arrow"
                  markerWidth="8"
                  markerHeight="8"
                  refX="7"
                  refY="4"
                  orient="auto"
                >
                  <path d="M0,0 L8,4 L0,8" fill="#94a3b8" />
                </marker>
              </defs>
              {edges.map((edge, index) => {
                const start = position(edge.source);
                const end = position(edge.target);
                const dx = end.x - start.x;
                const dy = end.y - start.y;
                const boundaryRatio = Math.max(
                  Math.abs(dx) / 126,
                  Math.abs(dy) / 34,
                );
                const offsetX = dx / boundaryRatio;
                const offsetY = dy / boundaryRatio;
                return (
                  <g key={`${edge.source}-${edge.target}-${index}`}>
                    <line
                      x1={start.x + offsetX}
                      y1={start.y + offsetY}
                      x2={end.x - offsetX}
                      y2={end.y - offsetY}
                      stroke="#b5c8bc"
                      strokeWidth="1.5"
                      markerEnd="url(#graph-arrow)"
                    />
                    <text
                      x={(start.x + end.x) / 2}
                      y={(start.y + end.y) / 2 - 8}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="11"
                    >
                      {relations[edge.relation]}
                    </text>
                  </g>
                );
              })}
              {visible.map((node) => {
                const point = position(node.id);
                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`查看${labels[node.type]}：${node.label}`}
                    onClick={() => select(node)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        select(node);
                      }
                    }}
                    style={{ cursor: "pointer" }}
                  >
                    <rect
                      x={point.x - 120}
                      y={point.y - 28}
                      width="240"
                      height="56"
                      rx="12"
                      fill={colors[node.type]}
                      stroke={node.id === selected?.id ? "#c6d9c9" : "white"}
                      strokeWidth="3"
                    />
                    <text
                      x={point.x}
                      y={point.y - 5}
                      textAnchor="middle"
                      fill="white"
                      fontSize="11"
                    >
                      {labels[node.type]}
                    </text>
                    <text
                      x={point.x}
                      y={point.y + 14}
                      textAnchor="middle"
                      fill="white"
                      fontSize="13"
                    >
                      {node.label.length > 17
                        ? `${node.label.slice(0, 16)}…`
                        : node.label}
                    </text>
                    {node.type === "atom" && (
                      <text
                        x={point.x}
                        y={point.y + 43}
                        textAnchor="middle"
                        fill="#475569"
                        fontSize="11"
                      >
                        {!evidence
                          ? evidenceError
                            ? "证据不可用"
                            : "读取证据中"
                          : evidence.atomic_skills
                                .find(
                                  (item) =>
                                    item.atomic_skill_id === node.reference_id,
                                )
                                ?.contexts.some(
                                  (item) => item.status !== "unmeasured",
                                )
                            ? "已有情境证据 · 点击查看"
                            : "尚未测量"}
                      </text>
                    )}
                    <title>{node.label}</title>
                  </g>
                );
              })}
            </svg>
          </section>
          <div className="graph-details-layout">
            <section className="panel graph-node-panel">
              <SectionHeading title={`全部匹配节点 · ${filtered.length}`} />
              {!filtered.length && <p>没有匹配节点，请调整筛选。</p>}
              <div className="graph-node-list">
                {filtered.map((node) => (
                  <button
                    key={node.id}
                    onClick={() => select(node)}
                    aria-pressed={node.id === selectedId}
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
                      {!evidence && (
                        <p>
                          {evidenceError ? "证据无法加载" : "正在加载证据…"}
                        </p>
                      )}
                      {personal?.contexts.map((item) => (
                        <p key={item.context}>
                          {item.context}：{statusLabels[item.status]} ·{" "}
                          {item.evidence_count} 条证据
                          {item.last_score != null
                            ? ` · 最近评分 ${item.last_score}`
                            : " · 未换算分数"}
                        </p>
                      ))}
                      {personal && (
                        <p>
                          {personal.transfer_observed
                            ? "已有跨情境观察"
                            : "尚无跨情境证据"}
                        </p>
                      )}
                      {evidence?.project_observations
                        ?.filter(
                          (o) => o.atomic_skill_id === atom.atomic_skill_id,
                        )
                        .slice(0, 5)
                        .map((o) => (
                          <div
                            className="project-graph-evidence"
                            key={o.observation_id}
                          >
                            <p>{o.finding.reason}</p>
                            {o.finding.quote && (
                              <blockquote>“{o.finding.quote}”</blockquote>
                            )}
                            <Link
                              className="text-primary"
                              to={`/projects/${o.project_id}`}
                            >
                              查看
                              {o.stage === "probe"
                                ? "追问"
                                : o.stage === "verification"
                                  ? "复测"
                                  : "初次回答"}
                              依据 →
                            </Link>
                          </div>
                        ))}
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
                            {["guided", "independent", "transfer"].map(
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
                <p>选择节点查看定义、关系和练习入口。</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
