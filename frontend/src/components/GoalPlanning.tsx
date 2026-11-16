import { useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  GitBranch,
  Layers3,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { Project } from "../types/projects";
import type { LearningPlan, PlanAtom } from "../types/planning";
import { ApiError, projectApi } from "../lib/api";
import { Notice } from "./workspace/Primitives";
import "./goalPlanning.css";

type Props = { project: Project; onUpdate: (project: Project) => void };
const lines = (text: string) => text.split("\n").map((line) => line.trim());

function AtomEditor({
  atom,
  plan,
  disabled,
  update,
  remove,
}: {
  atom: PlanAtom;
  plan: LearningPlan;
  disabled: boolean;
  update: (values: Partial<PlanAtom>) => void;
  remove: () => void;
}) {
  return (
    <article className="plan-atom-editor">
      <div className="plan-atom-heading">
        <label>
          原子名称
          <input
            maxLength={100}
            value={atom.name}
            onChange={(e) => update({ name: e.target.value })}
            disabled={disabled}
            required
          />
        </label>
        <button
          className="plan-remove"
          type="button"
          aria-label={`删除原子：${atom.name}`}
          disabled={disabled || plan.atoms.length <= 2}
          onClick={remove}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <label>
        所属知识模块
        <select
          value={atom.module_key}
          disabled={disabled}
          onChange={(e) => update({ module_key: e.target.value })}
        >
          {plan.modules.map((m) => (
            <option key={m.key} value={m.key}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        可观察的动作
        <textarea
          rows={2}
          maxLength={1000}
          value={atom.action}
          disabled={disabled}
          onChange={(e) => update({ action: e.target.value })}
        />
      </label>
      <div className="plan-two-fields">
        <label>
          给定什么
          <input
            maxLength={1500}
            value={atom.input_spec}
            disabled={disabled}
            onChange={(e) => update({ input_spec: e.target.value })}
          />
        </label>
        <label>
          需要产出什么
          <input
            maxLength={1500}
            value={atom.output_spec}
            disabled={disabled}
            onChange={(e) => update({ output_spec: e.target.value })}
          />
        </label>
      </div>
      <details>
        <summary>检查标准、前置与依据</summary>
        <div className="plan-atom-detail">
          <label>
            如何判断做到（每行一条，最多4条）
            <textarea
              rows={3}
              value={atom.rubric.join("\n")}
              disabled={disabled}
              onChange={(e) => update({ rubric: lines(e.target.value) })}
            />
          </label>
          <label>
            一个简短诊断问题
            <textarea
              rows={2}
              maxLength={500}
              value={atom.diagnostic_question}
              disabled={disabled}
              onChange={(e) => update({ diagnostic_question: e.target.value })}
            />
          </label>
          <label>
            适用条件（每行一条，最多3条）
            <textarea
              rows={2}
              value={atom.applicability_conditions.join("\n")}
              disabled={disabled}
              onChange={(e) =>
                update({ applicability_conditions: lines(e.target.value) })
              }
            />
          </label>
          <label>
            常见误用（每行一条，最多3条）
            <textarea
              rows={2}
              value={atom.common_misuses.join("\n")}
              disabled={disabled}
              onChange={(e) =>
                update({ common_misuses: lines(e.target.value) })
              }
            />
          </label>
          <label>
            适用边界
            <textarea
              rows={2}
              maxLength={1500}
              value={atom.boundary}
              disabled={disabled}
              onChange={(e) => update({ boundary: e.target.value })}
            />
          </label>
          <fieldset className="plan-prerequisites">
            <legend>前置能力（可不选；不可形成循环）</legend>
            {plan.atoms
              .filter((a) => a.key !== atom.key)
              .map((previous) => (
                <label key={previous.key}>
                  <input
                    type="checkbox"
                    checked={atom.prerequisite_keys.includes(previous.key)}
                    disabled={disabled}
                    onChange={(e) =>
                      update({
                        prerequisite_keys: e.target.checked
                          ? [...atom.prerequisite_keys, previous.key]
                          : atom.prerequisite_keys.filter(
                              (key) => key !== previous.key,
                            ),
                      })
                    }
                  />
                  {previous.name}
                </label>
              ))}
          </fieldset>
          <label>
            定义依据
            <select
              value={atom.basis}
              disabled={disabled}
              onChange={(e) =>
                update({
                  basis: e.target.value as PlanAtom["basis"],
                  source_quote: "",
                })
              }
            >
              <option value="proposal">教学补充建议 · 待核对</option>
              <option value="user_material">项目资料原文</option>
            </select>
          </label>
          {atom.basis === "user_material" && (
            <label>
              资料中逐字引用
              <textarea
                rows={3}
                maxLength={1000}
                value={atom.source_quote}
                disabled={disabled}
                onChange={(e) => update({ source_quote: e.target.value })}
              />
            </label>
          )}
        </div>
      </details>
    </article>
  );
}

export default function GoalPlanning({ project, onUpdate }: Props) {
  // Parent key includes the saved revision: new drafts and remote reloads have no stale form state.
  const [draft, setDraft] = useState<LearningPlan | null>(project.plan);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [conflict, setConflict] = useState(false);
  const retry = useRef({ signature: "", id: "" });
  const dirty = JSON.stringify(draft) !== JSON.stringify(project.plan);
  const pending = Boolean(busy);
  const act = async (action: "plan" | "save_plan" | "confirm_plan") => {
    if (pending || conflict) return;
    setBusy(action);
    setError("");
    const values = {
      action,
      revision: project.revision,
      ...(action === "plan" ? { answer: feedback } : {}),
      ...(action === "save_plan" ? { plan: draft } : {}),
    };
    const signature = JSON.stringify(values);
    if (signature !== retry.current.signature)
      retry.current = { signature, id: crypto.randomUUID() };
    try {
      const { project: saved } = await projectApi.act(project.project_id, {
        ...values,
        request_id: retry.current.id,
      });
      onUpdate(saved);
    } catch (failure) {
      setError((failure as Error).message);
      if (
        failure instanceof ApiError &&
        ["project_revision_conflict", "plan_locked"].includes(
          failure.code || "",
        )
      )
        setConflict(true);
    } finally {
      setBusy("");
    }
  };
  const reload = async () => {
    setBusy("reload");
    try {
      const { project: saved } = await projectApi.get(project.project_id);
      onUpdate(saved);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy("");
    }
  };
  const update = (values: Partial<LearningPlan>) =>
    setDraft((current) => (current ? { ...current, ...values } : current));
  const addAtom = () => {
    if (!draft || draft.atoms.length >= 6) return;
    const key = `a_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    update({
      atoms: [
        ...draft.atoms,
        {
          key,
          module_key: draft.modules[0].key,
          name: "新的原子动作",
          action: "",
          input_spec: "",
          output_spec: "",
          boundary: "",
          rubric: [""],
          prerequisite_keys: [],
          diagnostic_question: "",
          basis: "proposal",
          source_quote: "",
          applicability_conditions: [""],
          common_misuses: [""],
        },
      ],
    });
  };
  return (
    <section className="panel goal-planning" aria-label="个人目标拆解">
      <div className="plan-intro">
        <span className="plan-eyebrow">
          <Sparkles size={14} /> 从目标到可验证的行动
        </span>
        <h2>
          {draft ? "先看清要练什么，再开始" : "把想学的，拆成能检验的小步骤"}
        </h2>
        <p>
          先聚焦第一阶段，用知识模块连接 2–6
          个原子动作。方案可改、依据可查；确认后才进入诊断。
        </p>
      </div>
      {error && (
        <Notice onRetry={conflict ? () => void reload() : undefined}>
          {error}
          {conflict
            ? " 已暂停提交。重新加载将放弃本页未保存修改，避免覆盖另一窗口。"
            : ""}
        </Notice>
      )}
      {project.plan_feedback.length > 0 && (
        <details className="plan-feedback-history">
          <summary>
            已保存的范围补充 · {project.plan_feedback.length} 条
          </summary>
          {project.plan_feedback.map((text, i) => (
            <p key={i}>{text}</p>
          ))}
        </details>
      )}
      {draft?.disposition === "needs_clarification" && (
        <div className="plan-clarification">
          <h3>先确认 {draft.questions.length} 个关键点</h3>
          <ol>
            {draft.questions.map((question) => (
              <li key={question}>{question}</li>
            ))}
          </ol>
          <p>回答下面的问题后，再生成方案即可。还没有据此判断你的能力。</p>
        </div>
      )}
      {draft?.disposition === "ready" && (
        <>
          <div className="plan-review-status">
            <Layers3 size={17} /> {draft.modules.length} 个知识模块{" "}
            <ChevronRight size={14} /> {draft.atoms.length} 个原子动作{" "}
            <span>{dirty ? "有修改，尚未保存" : "草稿已保存 · 待你确认"}</span>
          </div>
          <div className="plan-scope-fields">
            <label>
              这一步的任务
              <input
                maxLength={180}
                value={draft.title}
                disabled={pending || conflict}
                onChange={(e) => update({ title: e.target.value })}
              />
            </label>
            <label>
              使用情境
              <input
                maxLength={160}
                value={draft.context}
                disabled={pending || conflict}
                onChange={(e) => update({ context: e.target.value })}
              />
            </label>
            <label>
              第一阶段练习范围
              <textarea
                maxLength={2000}
                rows={3}
                value={draft.scope}
                disabled={pending || conflict}
                onChange={(e) => update({ scope: e.target.value })}
              />
            </label>
            <label>
              希望完成的交付物
              <textarea
                maxLength={2000}
                rows={3}
                value={draft.deliverable}
                disabled={pending || conflict}
                onChange={(e) => update({ deliverable: e.target.value })}
              />
            </label>
            <label className="plan-full-field">
              这一步暂不覆盖
              <textarea
                maxLength={1500}
                rows={2}
                value={draft.exclusions}
                disabled={pending || conflict}
                onChange={(e) => update({ exclusions: e.target.value })}
              />
            </label>
          </div>
          <div className="plan-modules">
            {draft.modules.map((module) => (
              <section key={module.key} className="plan-module">
                <div className="plan-module-heading">
                  <GitBranch size={18} />
                  <label>
                    知识模块
                    <input
                      aria-label={`知识模块名称：${module.name}`}
                      maxLength={100}
                      value={module.name}
                      disabled={pending || conflict}
                      onChange={(e) =>
                        update({
                          modules: draft.modules.map((m) =>
                            m.key === module.key
                              ? { ...m, name: e.target.value }
                              : m,
                          ),
                        })
                      }
                    />
                  </label>
                  {!draft.atoms.some(
                    (atom) => atom.module_key === module.key,
                  ) && (
                    <button
                      type="button"
                      className="plan-remove"
                      aria-label={`删除空模块：${module.name}`}
                      disabled={pending || conflict}
                      onClick={() =>
                        update({
                          modules: draft.modules.filter(
                            (m) => m.key !== module.key,
                          ),
                        })
                      }
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
                <label className="plan-module-description">
                  模块说明
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={module.description}
                    disabled={pending || conflict}
                    onChange={(e) =>
                      update({
                        modules: draft.modules.map((m) =>
                          m.key === module.key
                            ? { ...m, description: e.target.value }
                            : m,
                        ),
                      })
                    }
                  />
                </label>
                <div className="plan-atoms">
                  {draft.atoms
                    .filter((atom) => atom.module_key === module.key)
                    .map((atom) => (
                      <AtomEditor
                        key={atom.key}
                        atom={atom}
                        plan={draft}
                        disabled={pending || conflict}
                        update={(values) =>
                          update({
                            atoms: draft.atoms.map((a) =>
                              a.key === atom.key ? { ...a, ...values } : a,
                            ),
                          })
                        }
                        remove={() => {
                          const atoms = draft.atoms
                            .filter((a) => a.key !== atom.key)
                            .map((a) => ({
                              ...a,
                              prerequisite_keys: a.prerequisite_keys.filter(
                                (key) => key !== atom.key,
                              ),
                            }));
                          update({
                            atoms,
                            modules: draft.modules.filter((m) =>
                              atoms.some((a) => a.module_key === m.key),
                            ),
                          });
                        }}
                      />
                    ))}
                </div>
              </section>
            ))}
          </div>
          <div className="plan-actions">
            <button
              className="btn-secondary"
              type="button"
              disabled={pending || conflict || draft.atoms.length >= 6}
              onClick={addAtom}
            >
              <Plus size={15} />
              补一个原子
            </button>
            <button
              className="btn-secondary"
              type="button"
              disabled={pending || conflict || !dirty}
              onClick={() => void act("save_plan")}
            >
              <Save size={15} />
              {busy === "save_plan" ? "正在检查并保存…" : "检查并保存修改"}
            </button>
            <button
              className="btn-primary"
              type="button"
              disabled={pending || conflict || dirty}
              onClick={() => void act("confirm_plan")}
            >
              <Check size={16} />
              确认方案，准备练习
            </button>
          </div>
          {dirty && (
            <p className="plan-footnote" role="status">
              先保存修改并通过引用与前置关系检查，再确认。刷新会丢失尚未保存的修改。
            </p>
          )}
        </>
      )}
      <div className="plan-generate">
        <label>
          {draft ? "补充范围或调整要求" : "补充你希望聚焦的范围（选填）"}
          <textarea
            maxLength={3000}
            rows={3}
            placeholder="例如：只学一元积分中的换元法，已有导数基础；希望先能解释为什么换元。"
            value={feedback}
            disabled={pending || conflict}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </label>
        <button
          className="btn-secondary"
          type="button"
          disabled={
            pending ||
            conflict ||
            (draft?.disposition === "needs_clarification" && !feedback.trim())
          }
          onClick={() => void act("plan")}
        >
          {draft ? <RotateCcw size={15} /> : <Sparkles size={15} />}
          {busy === "plan"
            ? "正在拆解并核对方案…"
            : draft
              ? "按补充信息重新生成"
              : "请教练拆解我的目标"}
        </button>
        <p className="plan-footnote">
          生成方案会使用已配置的
          AI，可能产生调用费用。重新生成会替换当前草稿；资料引用会核对原文，专业准确性仍需你检查。新定义仅属于本项目。
        </p>
      </div>
      {project.source_text && (
        <details className="plan-source">
          <summary>核对项目原始资料</summary>
          <pre>{project.source_text}</pre>
        </details>
      )}
    </section>
  );
}
