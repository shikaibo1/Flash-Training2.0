import { useEffect, useMemo, useState } from "react";
import { BookOpen, Filter, Layers3, Search, Sparkles } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { careerApi } from "../lib/api";
import type { GraphData } from "../types";
import {
  EmptyState,
  LoadingState,
  Notice,
  PageHeading,
  TextLink,
} from "../components/workspace/Primitives";

const modes = [
  ["guided", "引导"],
  ["independent", "独立"],
  ["transfer", "迁移"],
] as const;
export default function SkillsLibrary() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [queryParams, setQueryParams] = useSearchParams();
  const query = queryParams.get("q") || "";
  const [role, setRole] = useState("");
  const [kind, setKind] = useState<"tasks" | "atoms">("tasks");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    careerApi
      .graph()
      .then((value) => {
        if (active) setGraph(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  const search = query.trim().toLowerCase();
  const tasks = useMemo(
    () =>
      graph?.tasks.filter(
        (task) =>
          (!role || task.role_id === role) &&
          `${task.name} ${task.display_name} ${task.description} ${task.context}`
            .toLowerCase()
            .includes(search),
      ) || [],
    [graph, role, search],
  );
  const atoms = useMemo(
    () =>
      graph?.atoms.filter(
        (atom) =>
          (!role ||
            graph.tasks.some(
              (task) =>
                task.role_id === role &&
                task.atomic_skills.includes(atom.atomic_skill_id),
            )) &&
          `${atom.name} ${atom.description} ${atom.action}`
            .toLowerCase()
            .includes(search),
      ) || [],
    [graph, role, search],
  );
  const updateQuery = (value: string) => {
    const next = new URLSearchParams(queryParams);
    if (value) next.set("q", value);
    else next.delete("q");
    setQueryParams(next, { replace: true });
  };
  return (
    <div className="page-stack page-stack-wide">
      <PageHeading
        eyebrow="PRACTICE LIBRARY"
        title="选择一个值得完成的任务"
        description="从具体交付物开始练习。每个任务都会说明需要哪些行动能力，以及如何用引导、独立和迁移方式继续。"
        action={<TextLink to="/graph">查看能力图谱</TextLink>}
      />
      <section className="library-toolbar">
        <div className="library-search">
          <Search size={17} />
          <input
            aria-label="搜索任务或能力"
            placeholder="搜索任务、情境或原子能力"
            value={query}
            onChange={(event) => updateQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="职业筛选"
          value={role}
          onChange={(event) => setRole(event.target.value)}
        >
          <option value="">全部职业</option>
          {graph?.roles.map((item) => (
            <option key={item.role_id} value={item.role_id}>
              {item.name}
            </option>
          ))}
        </select>
        <div className="view-toggle">
          <button
            className={kind === "tasks" ? "active" : ""}
            onClick={() => setKind("tasks")}
          >
            <BookOpen size={15} />
            任务
          </button>
          <button
            className={kind === "atoms" ? "active" : ""}
            onClick={() => setKind("atoms")}
          >
            <Layers3 size={15} />
            原子
          </button>
        </div>
      </section>
      {error && (
        <Notice onRetry={() => window.location.reload()}>{error}</Notice>
      )}
      {loading && <LoadingState label="正在加载任务目录…" />}
      {!loading && kind === "tasks" && (
        <>
          {!tasks.length ? (
            <EmptyState
              title="没有找到匹配任务"
              description="换个关键词，或先浏览全部任务。"
              icon={Filter}
            />
          ) : (
            <div className="task-card-grid">
              {tasks.map((task, index) => (
                <article className="task-card" key={task.skill_id}>
                  <div className="task-card-top">
                    <span className="task-index">0{index + 1}</span>
                    <span className="task-context">
                      {
                        graph?.roles.find(
                          (item) => item.role_id === task.role_id,
                        )?.name
                      }{" "}
                      · {task.context}
                    </span>
                  </div>
                  <h2>{task.display_name || task.name}</h2>
                  <p>{task.task_brief || task.description}</p>
                  <div className="deliverable">
                    <span>交付物</span>
                    {task.deliverable}
                  </div>
                  <div className="atom-pills">
                    {task.atomic_skills.map((id) => (
                      <Link
                        key={id}
                        to={`/graph?node=${encodeURIComponent(`atom:${id}`)}`}
                      >
                        {graph?.atoms.find(
                          (atom) => atom.atomic_skill_id === id,
                        )?.name || id}
                      </Link>
                    ))}
                  </div>
                  <div className="task-actions">
                    {modes.map(([mode, label]) => (
                      <Link
                        key={mode}
                        className={
                          mode === "independent" ? "primary-action" : ""
                        }
                        to={`/practice/${encodeURIComponent(task.skill_id)}?mode=${mode}`}
                      >
                        {label}练习
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
      {!loading && kind === "atoms" && (
        <>
          {!atoms.length ? (
            <EmptyState
              title="没有找到匹配能力"
              description="尝试搜索“提炼”“核算”或“检查”等行动。"
              icon={Layers3}
            />
          ) : (
            <div className="atom-card-grid">
              {atoms.map((atom) => (
                <Link
                  className="atom-card"
                  key={atom.atomic_skill_id}
                  to={`/graph?node=${encodeURIComponent(`atom:${atom.atomic_skill_id}`)}`}
                >
                  <div className="atom-card-icon">
                    <Sparkles size={18} />
                  </div>
                  <div>
                    <span className="task-context">
                      行动原子 · v{atom.version}
                    </span>
                    <h2>{atom.name}</h2>
                    <p>{atom.action}</p>
                    <small>{atom.contexts.join(" · ")}</small>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
