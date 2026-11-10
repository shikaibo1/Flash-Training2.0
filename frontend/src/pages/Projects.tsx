import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, Plus, Target } from "lucide-react";
import { projectApi, skillsApi } from "../lib/api";
import type { Skill } from "../types";
import { projectStatus, SQL_TASK } from "../types/projects";
import type { Project } from "../types/projects";
import {
  LoadingState,
  Notice,
  PageHeading,
  SectionHeading,
  EmptyState,
} from "../components/workspace/Primitives";

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [tasks, setTasks] = useState<Skill[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRef({ signature: "", id: "" });
  const [form, setForm] = useState({
    goal: "",
    background: "",
    deliverable: "",
    source_text: "",
    task_id: "",
    probe_limit: 2,
  });
  const load = () => {
    setError("");
    Promise.all([projectApi.list(), skillsApi.getAllSkills()])
      .then(([list, catalog]) => {
        setProjects(list.projects);
        setTasks(
          catalog.skills.filter((t) => t.enabled && t.skill_id !== SQL_TASK),
        );
      })
      .catch((e) => setError(e.message));
  };
  useEffect(load, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = { ...form, task_id: form.task_id || null };
    const signature = JSON.stringify(values);
    if (request.current.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    try {
      const { project } = await projectApi.create({
        ...values,
        request_id: request.current.id,
      });
      navigate(`/projects/${project.project_id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page-stack">
      <PageHeading
        eyebrow="GOAL → EVIDENCE → ACTION"
        title="从想学什么，到能独立完成"
        description="先保存你的目标，再用一次短任务找准下一步。证据足够就结束诊断，不要求做完一长串问答。"
      />
      {error && <Notice onRetry={load}>{error}</Notice>}
      <div className="project-columns">
        <section className="panel project-form">
          <SectionHeading title="创建学习目标" />
          <form onSubmit={submit} className="space-y-4">
            <label>
              想学什么{" "}
              <input
                required
                minLength={2}
                maxLength={1000}
                placeholder="例如：把数据库课知识用于订单数据分析"
                value={form.goal}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
              />
            </label>
            <label>
              已有基础{" "}
              <textarea
                maxLength={3000}
                rows={2}
                placeholder="学过什么，哪里不确定？（选填）"
                value={form.background}
                onChange={(e) =>
                  setForm({ ...form, background: e.target.value })
                }
              />
            </label>
            <label>
              希望完成什么{" "}
              <input
                maxLength={2000}
                placeholder="例如：能独立核对净收入，解释查询结果（选填）"
                value={form.deliverable}
                onChange={(e) =>
                  setForm({ ...form, deliverable: e.target.value })
                }
              />
            </label>
            <label>
              练习范围{" "}
              <select
                value={form.task_id}
                onChange={(e) => setForm({ ...form, task_id: e.target.value })}
              >
                <option value="">先保存目标，稍后规划</option>
                <option value={SQL_TASK}>
                  推荐体验：数据库 → 订单数据分析
                </option>
                {tasks.map((t) => (
                  <option key={t.skill_id} value={t.skill_id}>
                    {t.display_name}
                  </option>
                ))}
              </select>
            </label>
            <p className="text-sm text-muted-foreground">
              本版先验证已有任务中的学习闭环。任意目标均可保存；尚不自动拆解全部学科。
            </p>
            <details>
              <summary>补充资料与诊断节奏</summary>
              <div className="space-y-4 pt-4">
                <label>
                  粘贴文字资料{" "}
                  <textarea
                    maxLength={30000}
                    rows={5}
                    placeholder="作为学习背景保存；内置体验仍使用可核验的模拟数据。"
                    value={form.source_text}
                    onChange={(e) =>
                      setForm({ ...form, source_text: e.target.value })
                    }
                  />
                </label>
                <label>
                  每轮最多追问{" "}
                  <select
                    value={form.probe_limit}
                    onChange={(e) =>
                      setForm({ ...form, probe_limit: Number(e.target.value) })
                    }
                  >
                    <option value={2}>2 次 · 默认</option>
                    <option value={1}>1 次 · 更简短</option>
                    <option value={0}>不追问 · 保留不确定项</option>
                  </select>
                </label>
              </div>
            </details>
            <button disabled={busy} type="submit" className="btn-primary">
              <Plus size={17} />
              {busy ? "正在保存…" : "保存学习目标"}
            </button>
          </form>
        </section>
        <section>
          <SectionHeading
            title="继续我的学习"
            description="目标、草稿与每次判断都会保留。"
          />
          {!projects && !error && <LoadingState />}
          {projects?.length === 0 && (
            <EmptyState
              icon={Target}
              title="第一个目标，从这里开始"
              description="可以先保存目标，也可以选择推荐场景立即体验。"
            />
          )}
          <div className="space-y-3">
            {projects?.map((p) => (
              <Link
                key={p.project_id}
                to={`/projects/${p.project_id}`}
                className="panel project-resume"
              >
                <div>
                  <span className="eyebrow">{projectStatus[p.status]}</span>
                  <h3>{p.goal}</h3>
                  <p>
                    {p.atoms.length} 个目标原子 ·{" "}
                    {p.rounds.filter((r) => r.assessment).length} 次回答
                  </p>
                </div>
                <ArrowRight size={18} />
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
