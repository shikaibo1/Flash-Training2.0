import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle2,
  Lightbulb,
  Save,
  Target,
} from "lucide-react";
import { ApiError, projectApi, skillsApi } from "../lib/api";
import { useAccount } from "../hooks/useAccount";
import type { Skill } from "../types";
import type { Project } from "../types/projects";
import { findingLabels, projectStatus, SQL_TASK } from "../types/projects";
import {
  Notice,
  LoadingState,
  PageHeading,
  SectionHeading,
} from "../components/workspace/Primitives";

export default function ProjectWorkspace() {
  const { account } = useAccount();
  const { id = "" } = useParams();
  const [project, setProject] = useState<Project | null>(null);
  const current = useRef<Project | null>(null);
  const [tasks, setTasks] = useState<Skill[]>([]);
  const [task, setTask] = useState(SQL_TASK);
  const [answer, setAnswer] = useState("");
  const [microAnswer, setMicroAnswer] = useState("");
  const [helpTarget, setHelpTarget] = useState("");
  const [numeric, setNumeric] = useState("");
  const [assisted, setAssisted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState("");
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const draftNumber = useRef(0);
  const retry = useRef({ signature: "", id: "" });
  const accept = (p: Project, restore = false) => {
    current.current = p;
    setProject(p);
    const r = p.rounds.at(-1);
    draftNumber.current = Math.max(draftNumber.current, r?.draft_number || 0);
    if (restore) {
      let recovered: {
        text: string;
        number: string;
        help: boolean;
        revision: number;
      } | null = null;
      try {
        const cache = JSON.parse(
          localStorage.getItem(
            `project-draft:${account.user_id}:${p.project_id}:${r?.round_id}`,
          ) || "null",
        );
        if (
          cache &&
          !r?.assessment &&
          typeof cache.text === "string" &&
          cache.text.length <= 20000 &&
          typeof cache.number === "string" &&
          (cache.number === "" || Number.isFinite(Number(cache.number))) &&
          typeof cache.help === "boolean" &&
          Number.isSafeInteger(cache.revision) &&
          cache.revision >= p.revision
        )
          recovered = cache;
      } catch {
        /* server draft remains the source of truth if local storage is unavailable */
      }
      setAnswer(recovered?.text ?? r?.draft ?? "");
      setNumeric(
        recovered?.number ??
          (r?.numeric_answer == null ? "" : String(r.numeric_answer)),
      );
      setAssisted(recovered?.help || r?.assistance_used || false);
    }
  };
  const edit = (text: string, number: string, help: boolean) => {
    setAnswer(text);
    setNumeric(number);
    setAssisted(help);
    const p = current.current,
      r = p?.rounds.at(-1);
    if (p && r) {
      try {
        localStorage.setItem(
          `project-draft:${account.user_id}:${p.project_id}:${r.round_id}`,
          JSON.stringify({ text, number, help, revision: p.revision }),
        );
      } catch {
        /* server autosave continues */
      }
    }
  };
  useEffect(() => {
    let active = true;
    projectApi
      .get(id)
      .then(({ project: p }) => {
        if (active) accept(p, true);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    skillsApi
      .getAllSkills()
      .then((v) => {
        if (active)
          setTasks(
            v.skills.filter((s) => s.enabled && s.skill_id !== SQL_TASK),
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [id]);
  const round = project?.rounds.at(-1);
  const answering =
    project?.status === "answering" || project?.status === "probing";
  const flush = (text: string, number: string, help: boolean) => {
    const work = async () => {
      const p = current.current,
        r = p?.rounds.at(-1);
      if (
        !p ||
        !r ||
        r.assessment ||
        !["answering", "probing"].includes(p.status)
      )
        return;
      const value = number.trim() === "" ? null : Number(number);
      if (
        text === r.draft &&
        value === r.numeric_answer &&
        help === r.assistance_used
      ) {
        setSaved("进度已保存");
        return;
      }
      const { project: next } = await projectApi.draft(p.project_id, {
        round_id: r.round_id,
        revision: p.revision,
        text,
        numeric_answer: value,
        assistance_used: help,
        draft_number: ++draftNumber.current,
      });
      if (current.current?.project_id === next.project_id) {
        accept(next);
        setSaved("进度已保存");
      }
    };
    queue.current = queue.current.catch(() => {}).then(work);
    return queue.current;
  };
  // Server autosave is serialized; a local recovery copy also covers an immediate refresh.
  useEffect(() => {
    if (!answering || busy || conflict) return;
    setSaved("正在保存…");
    const timer = window.setTimeout(() => {
      flush(answer, numeric, assisted)?.catch((e) => {
        setSaved("保存失败");
        setError(e.message);
        if (e instanceof ApiError && e.code === "project_revision_conflict")
          setConflict(true);
      });
    }, 600);
    return () => window.clearTimeout(timer);
    // flush reads current project through a ref, so loading a saved revision does not restart this timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, numeric, assisted, answering, busy, conflict]);
  const act = async (action: string, level?: string) => {
    if (conflict) return;
    setBusy(true);
    setError("");
    try {
      if (answering && action === "answer")
        await flush(answer, numeric, assisted);
      else await queue.current.catch(() => {});
      const p = current.current!;
      const values = {
        action,
        revision: p.revision,
        round_id: p.rounds.at(-1)?.round_id,
        answer:
          action === "reflect"
            ? microAnswer
            : action === "answer"
              ? answer
              : "",
        numeric_answer:
          action === "answer" && numeric !== "" ? Number(numeric) : null,
        assistance_used: assisted,
        ...(level ? { level } : {}),
        ...(action === "bind" ? { task_id: task } : {}),
        ...(action === "help" && helpTarget
          ? { atomic_skill_id: helpTarget }
          : {}),
      };
      const signature = JSON.stringify(values);
      if (retry.current.signature !== signature)
        retry.current = { signature, id: crypto.randomUUID() };
      const { project: next } = await projectApi.act(id, {
        ...values,
        request_id: retry.current.id,
      });
      accept(next, true);
      setSaved("进度已保存");
      if (action === "reflect") setMicroAnswer("");
    } catch (e) {
      setError((e as Error).message);
      if (
        e instanceof ApiError &&
        ["project_revision_conflict", "round_finished"].includes(e.code || "")
      )
        setConflict(true);
      // Reconcile lost replies or another window's writes before another action.
      try {
        const { project: p } = await projectApi.get(id);
        accept(p, false);
      } catch {
        /* keep local answer */
      }
    } finally {
      setBusy(false);
    }
  };
  if (!project)
    return (
      <div className="page-stack">
        {error ? <Notice>{error}</Notice> : <LoadingState />}
      </div>
    );
  const settled = ["support", "review", "completed"].includes(project.status);
  const findings = project.findings;
  return (
    <div className="page-stack project-workspace">
      <PageHeading
        eyebrow="LEARNING PROJECT"
        title={project.goal}
        description={project.scope_note}
        action={
          <Link className="text-primary" to="/projects">
            全部目标 →
          </Link>
        }
      />
      <ol className="project-steps" aria-label="学习进度">
        {["目标与任务", "简短诊断", "针对性帮助", "新任务复测"].map((s, i) => (
          <li
            key={s}
            className={
              i ===
              (project.status === "pending" || project.status === "ready"
                ? 0
                : project.status === "completed"
                  ? 3
                  : answering
                    ? round?.stage === "verification"
                      ? 3
                      : 1
                    : 2)
                ? "active"
                : ""
            }
          >
            <span>{i + 1}</span>
            {s}
          </li>
        ))}
      </ol>
      {error && (
        <Notice
          onRetry={
            conflict
              ? async () => {
                  try {
                    const { project: p } = await projectApi.get(id);
                    accept(p, true);
                    setConflict(false);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }
              : undefined
          }
        >
          {error}
          {conflict &&
            " 已暂停自动保存。重新加载后继续，避免覆盖另一窗口的进度。"}
        </Notice>
      )}
      <div className="project-state">
        <span>
          <Target size={17} />
          {projectStatus[project.status]}
        </span>
        <small>
          <Save size={14} />
          {saved || "已读取保存的进度"}
        </small>
      </div>
      {project.status === "pending" && (
        <section className="panel project-form space-y-4">
          <h2>先为目标选择适用的练习范围</h2>
          <p>
            当前不会自动把任意目标匹配到无关技能。可以保留为待规划，或选择下面的任务开始。
          </p>
          <label>
            练习任务
            <select value={task} onChange={(e) => setTask(e.target.value)}>
              <option value={SQL_TASK}>数据库 → 订单数据分析</option>
              {tasks.map((t) => (
                <option key={t.skill_id} value={t.skill_id}>
                  {t.display_name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => act("bind")}
          >
            确认练习范围
          </button>
        </section>
      )}
      {project.status === "ready" && (
        <section className="panel space-y-4 p-6">
          <h2>先尝试，再决定怎么学</h2>
          <p>
            一次短任务，最多 {project.probe_limit}{" "}
            次简短确认，证据足够就停。随后只帮助你当前需要的部分。
          </p>
          <div className="project-atom-tags">
            {project.atoms.map((a) => (
              <span key={a.atomic_skill_id}>{a.name}</span>
            ))}
          </div>
          <button
            disabled={busy}
            className="btn-primary"
            onClick={() => act("start")}
          >
            开始第一次尝试 <ArrowRight size={16} />
          </button>
        </section>
      )}
      {answering && round && (
        <section className="panel project-answer">
          <div className="flex justify-between flex-wrap gap-2">
            <span className="eyebrow">
              {round.stage === "probe"
                ? `简短确认 ${project.probes_used} / ${project.probe_limit}`
                : round.stage === "verification"
                  ? "新材料 · 独立复测"
                  : "初次尝试"}
            </span>
            {round.stage === "probe" && (
              <button
                disabled={busy}
                className="text-primary"
                onClick={() => act("skip")}
              >
                跳过，保留不确定项
              </button>
            )}
          </div>
          <h2>{round.content.title}</h2>
          <p className="whitespace-pre-wrap">{round.content.description}</p>
          {round.stage === "probe" ? (
            <details>
              <summary>查看本题材料</summary>
              <pre>{round.content.materials}</pre>
            </details>
          ) : (
            <pre>{round.content.materials}</pre>
          )}
          {round.variant !== null && (
            <label>
              净收入（元）
              <input
                type="number"
                step="any"
                disabled={busy}
                value={numeric}
                onChange={(e) => edit(answer, e.target.value, assisted)}
                placeholder="填写你算出的金额"
              />
            </label>
          )}
          <label>
            {round.stage === "probe" ? "简短说明即可" : "你的思路与检查方法"}
            <textarea
              rows={round.stage === "probe" ? 4 : 7}
              maxLength={20000}
              disabled={busy}
              value={answer}
              onChange={(e) => edit(e.target.value, numeric, assisted)}
              placeholder="自然语言、算式或 SQL 均可，接受有效的不同方法。"
            />
          </label>
          <label className="project-check">
            <input
              type="checkbox"
              disabled={busy || round.assistance_used}
              checked={assisted}
              onChange={(e) => edit(answer, numeric, e.target.checked)}
            />
            本轮使用过他人、AI 或答案帮助
          </label>
          <div className="flex gap-3 flex-wrap items-center">
            <button
              className="btn-primary"
              disabled={
                busy ||
                !answer.trim() ||
                (round.variant !== null && numeric === "")
              }
              onClick={() => act("answer")}
            >
              {busy ? "正在检查依据…" : "提交并决定下一步"}
              <ArrowRight size={16} />
            </button>
            <small className="text-muted-foreground">
              {round.stage === "probe"
                ? "只确认一个关键点"
                : "不按答案长度评价能力"}
            </small>
          </div>
        </section>
      )}
      {project.decision_reason && (
        <div className="project-decision">
          <Lightbulb size={19} />
          <div>
            <strong>为什么走这一步</strong>
            <p>{project.decision_reason}</p>
          </div>
        </div>
      )}
      {findings.length > 0 && (
        <section className="panel p-6">
          <SectionHeading
            title="这次观察到了什么"
            description="每个判断都保留依据；未获得证据不等于不会。"
          />
          <div className="project-findings">
            {findings.map((f) => (
              <article
                key={f.atomic_skill_id}
                className={`finding finding-${f.state}`}
              >
                <span>{findingLabels[f.state]}</span>
                <h3>
                  {
                    project.atoms.find(
                      (a) => a.atomic_skill_id === f.atomic_skill_id,
                    )?.name
                  }
                </h3>
                <p>{f.reason}</p>
                {f.quote && <blockquote>“{f.quote}”</blockquote>}
                <small>下一步：{f.next_action}</small>
              </article>
            ))}
          </div>
        </section>
      )}
      {settled && (
        <section className="panel p-6 space-y-5">
          <SectionHeading
            title={
              project.status === "completed"
                ? "这次新任务已独立通过"
                : "把缺口变成下一步行动"
            }
            description="提示、讲解和局部练习不计为独立掌握；新题结果单独记录。"
          />
          {project.status === "completed" && (
            <p className="text-primary flex gap-2">
              <CheckCircle2 size={20} />
              这只说明本次任务有支持证据，后续仍需检验稳定性。
            </p>
          )}
          <label className="project-help-target">
            这次想补哪一项
            <select
              value={helpTarget}
              disabled={busy}
              onChange={(e) => setHelpTarget(e.target.value)}
            >
              <option value="">让教练优先选择当前缺口</option>
              {findings.map((f) => (
                <option key={f.atomic_skill_id} value={f.atomic_skill_id}>
                  {
                    project.atoms.find(
                      (a) => a.atomic_skill_id === f.atomic_skill_id,
                    )?.name
                  }{" "}
                  · {findingLabels[f.state]}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-3">
            {(
              [
                ["hint", "给一点提示"],
                ["explain", "解释关键原因"],
                ["micro", "做一个局部练习"],
              ] as const
            ).map(([level, label]) => (
              <button
                className="btn-secondary"
                disabled={busy}
                key={level}
                onClick={() => act("help", level)}
              >
                {label}
              </button>
            ))}
          </div>
          {project.interventions.map((h, i) => (
            <article className="project-help" key={i}>
              <span className="eyebrow">
                学习支持 · {i + 1} ·{" "}
                {
                  project.atoms.find(
                    (a) => a.atomic_skill_id === h.atomic_skill_id,
                  )?.name
                }
              </span>
              <h3>{h.title}</h3>
              <p className="whitespace-pre-wrap">{h.text}</p>
              {h.exercise && (
                <p className="pt-3">
                  <strong>自己试试：</strong>
                  {h.exercise}
                </p>
              )}
              <small>{h.source}</small>
            </article>
          ))}
          {project.interventions.at(-1)?.level === "micro" && (
            <div className="project-form space-y-3">
              <label>
                局部练习回答
                <textarea
                  maxLength={4000}
                  rows={3}
                  value={microAnswer}
                  onChange={(e) => setMicroAnswer(e.target.value)}
                  placeholder="简短记录自己的推理；这次练习不会计入独立掌握。"
                />
              </label>
              <button
                className="btn-secondary"
                disabled={busy || !microAnswer.trim()}
                onClick={() => act("reflect")}
              >
                保存这次练习
              </button>
            </div>
          )}
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => act("verify")}
          >
            {busy ? "正在准备…" : "用一道没见过的任务检验"}
            <ArrowRight size={17} />
          </button>
          <p className="text-sm text-muted-foreground">
            无需继续也可以直接离开，当前进度已保存。
          </p>
        </section>
      )}
      <details className="panel p-6">
        <summary>
          查看学习过程与原始回答（{project.events.length} 条记录）
        </summary>
        <div className="space-y-5 pt-5">
          {project.rounds
            .filter((r) => r.assessment)
            .map((r) => (
              <article key={r.round_id}>
                <h3>
                  {r.stage === "probe"
                    ? "追问回答"
                    : r.stage === "verification"
                      ? "新题复测"
                      : "首次回答"}{" "}
                  · {r.assistance_used ? "使用帮助" : "未报告帮助"}
                </h3>
                <p>{r.content.description}</p>
                <blockquote className="whitespace-pre-wrap">
                  {r.answer}
                </blockquote>
                <p>{r.assessment?.summary}</p>
              </article>
            ))}
          {project.events.map((e) => (
            <article key={e.event_id}>
              <small>{new Date(e.created_at).toLocaleString()}</small>
              <p>{e.summary}</p>
              {e.decision && (
                <p className="text-muted-foreground">{e.decision}</p>
              )}
            </article>
          ))}
        </div>
      </details>
      <div className="flex gap-5">
        <Link to="/graph" className="text-primary">
          查看能力图谱 →
        </Link>
        <Link to="/learning-curve" className="text-primary">
          检查完整证据 →
        </Link>
      </div>
    </div>
  );
}
