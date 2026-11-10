import { useEffect, useRef, useState } from "react";
import { Brain, ChevronLeft, RefreshCw } from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import FeedbackPanel from "../components/FeedbackPanel";
import { PageHeading } from "../components/workspace/Primitives";
import { useQueryClient } from "@tanstack/react-query";
import { practiceV1Api } from "../lib/api";
import type { SessionData } from "../lib/api";
import { scoreDimensions } from "../lib/feedback";
import type { ScoreDimension } from "../lib/feedback";
import { sessionCache } from "../lib/sessionCache";
import type {
  PracticeContent,
  PracticeRecord,
  EvidenceItem,
  AgentTrace,
} from "../types";

const userId = "default_user";
type Feedback = {
  score: number;
  strengths: string[];
  improvements: string[];
  aiComment: string;
  dimensions: ScoreDimension[];
};
type Session = SessionData;
// Shares an in-flight request across React effect remounts; no duplicate model requests.
const pendingSessions = new Map<string, Promise<Session>>();

async function obtainSession(
  skillId: string,
  mode: string,
  targetIds: string[],
): Promise<Session> {
  const key = `flash-session:${userId}:${skillId}:${mode}:${targetIds.join(",")}`;
  const pending = pendingSessions.get(key);
  if (pending) return pending;
  const work = (async () => {
    const saved = sessionCache.read(key);
    if (saved) {
      try {
        const result = await practiceV1Api.getSession(userId, saved);
        if (result.data.status === "active" || result.data.evaluation_result)
          return result.data;
      } catch (error) {
        // Only an absent session is discarded. Network/configuration errors stay visible.
        if (
          !(error instanceof Error) ||
          !("status" in error) ||
          error.status !== 404
        )
          throw error;
      }
      sessionCache.remove(key);
    }
    const result = await practiceV1Api.startPractice(userId, skillId, {
      mode,
      ...(targetIds.length ? { target_atomic_ids: targetIds } : {}),
    });
    sessionCache.write(key, result.data.session_id);
    return result.data as Session;
  })();
  pendingSessions.set(key, work);
  try {
    return await work;
  } finally {
    if (pendingSessions.get(key) === work) pendingSessions.delete(key);
  }
}

const PracticeSession = () => {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const requestedMode = search.get("mode") || "guided";
  const mode = ["guided", "independent", "transfer"].includes(requestedMode)
    ? requestedMode
    : "guided";
  const targetKey = Array.from(
    new Set((search.get("atoms") || "").split(",").filter(Boolean)),
  )
    .sort()
    .join(",");
  const [assisted, setAssisted] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [trace, setTrace] = useState<AgentTrace[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [content, setContent] = useState<PracticeContent | null>(null);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [showExample, setShowExample] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const submitLock = useRef<string | null>(null);
  const historyRecord = (
    location.state as { fromHistory?: boolean; record?: PracticeRecord } | null
  )?.fromHistory
    ? (location.state as { record: PracticeRecord }).record
    : null;

  const displayMode = session?.mode || historyRecord?.mode || mode;

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    let active = true;
    setLoading(true);
    setSession(null);
    setContent(null);
    setSubmitting(false);
    setError("");
    setDraftNotice("");
    setFeedback(null);
    setAnswer("");
    setShowExample(false);
    setShowHint(false);
    setAssisted(false);
    setEvidence([]);
    setTrace([]);
    const load = async () => {
      if (historyRecord) {
        setContent({
          title: historyRecord.title || historyRecord.skill_name,
          description: historyRecord.description || "",
          category: historyRecord.category,
          difficulty: historyRecord.difficulty,
          hint: historyRecord.hint,
          example_answer: historyRecord.example_answer,
          materials: historyRecord.materials,
        });
        setEvidence(historyRecord.evidence || []);
        setTrace(historyRecord.agent_trace || []);
        setAnswer(historyRecord.transcript || "");
        setFeedback({
          score: historyRecord.score,
          strengths: historyRecord.strengths || [],
          improvements: historyRecord.improvements || [],
          aiComment: historyRecord.ai_comment || "",
          dimensions: scoreDimensions(
            historyRecord.atomic_skill_scores,
            historyRecord.atomic_skill_names,
          ),
        });
        if (historyRecord.session_id) {
          try {
            const saved = (
              await practiceV1Api.getSession(userId, historyRecord.session_id)
            ).data;
            if (!active) return;
            setSession(saved);
            setContent(saved.content);
            setEvidence(saved.evaluation_result?.evidence || []);
            setTrace([
              ...(saved.agent_trace || []),
              ...(saved.evaluation_result?.agent_trace || []),
            ]);
          } catch (err) {
            if (active)
              setError(
                err instanceof Error
                  ? `记录正文已保留，但会话详情读取失败：${err.message}`
                  : "会话详情读取失败",
              );
          }
        }
        if (active) setLoading(false);
        return;
      }
      try {
        let skillId = id;
        if (!id || id === "random") {
          const skills = (await practiceV1Api.getAvailableSkills()).skills;
          skillId = skills[Math.floor(Math.random() * skills.length)]?.skill_id;
        }
        if (!skillId) throw new Error("暂无可练习的职业任务。");
        if ((!id || id === "random") && active) {
          navigate(
            `/practice/${encodeURIComponent(skillId)}${location.search}`,
            { replace: true },
          );
          return;
        }
        if (!active) return;
        const value = await obtainSession(
          skillId,
          mode,
          targetKey ? targetKey.split(",") : [],
        );
        if (active) {
          setSession(value);
          setAssisted(
            sessionCache.read(`flash-assisted:${value.session_id}`) === "true",
          );
          setTrace([
            ...(value.agent_trace || value.content.agent_trace || []),
            ...(value.evaluation_result?.agent_trace || []),
          ]);
          setEvidence(value.evaluation_result?.evidence || []);
          setContent(value.content);
          if (value.status === "completed" && value.evaluation_result) {
            const result = value.evaluation_result;
            setAnswer(value.answer || "");
            setFeedback({
              score: Math.round(result.score * 10),
              strengths: result.strengths,
              improvements: result.improvements,
              aiComment: result.aiComment,
              dimensions: scoreDimensions(
                result.atomic_skill_scores,
                value.atomic_skill_names,
              ),
            });
          } else {
            setAnswer(
              sessionCache.read(`flash-draft:${value.session_id}`) || "",
            );
          }
        }
      } catch (err) {
        if (active)
          setError(err instanceof Error ? err.message : "加载失败，请重试。");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [id, historyRecord, revision, mode, targetKey, navigate, location.search]);

  const submit = async () => {
    if (!session || !answer.trim() || submitLock.current === session.session_id)
      return;
    const requestGeneration = generation.current;
    const requestSessionId = session.session_id;
    submitLock.current = requestSessionId;
    setSubmitting(true);
    setError("");
    try {
      const result = await practiceV1Api.submitAnswer(
        userId,
        session.session_id,
        answer,
        assisted,
      );
      const evaluation = result.data.evaluation_result;
      const cacheKey = `flash-session:${userId}:${session.skill_id}:${mode}:${targetKey}`;
      if (sessionCache.read(cacheKey) === session.session_id)
        sessionCache.remove(cacheKey);
      sessionCache.remove(`flash-draft:${session.session_id}`);
      window.dispatchEvent(
        new CustomEvent("practice:record-saved", {
          detail: { recordId: result.data.record_id },
        }),
      );
      window.dispatchEvent(new CustomEvent("practice:completed"));
      void queryClient.invalidateQueries({ queryKey: ["practice-records"] });
      void queryClient.invalidateQueries({ queryKey: ["career-evidence"] });
      void queryClient.invalidateQueries({
        queryKey: ["career-recommendations"],
      });
      if (mounted.current && generation.current === requestGeneration) {
        setEvidence(evaluation.evidence || []);
        setTrace([
          ...(session.agent_trace || session.content.agent_trace || []),
          ...(evaluation.agent_trace || []),
        ]);
        setFeedback({
          score: Math.round(evaluation.score * 10),
          strengths: evaluation.strengths,
          improvements: evaluation.improvements,
          aiComment: evaluation.aiComment,
          dimensions: scoreDimensions(
            evaluation.atomic_skill_scores,
            session.atomic_skill_names,
          ),
        });
        // Completed sessions can expose reference material withheld during independent work.
        if (mode !== "guided") {
          try {
            const completed = (
              await practiceV1Api.getSession(userId, requestSessionId)
            ).data;
            if (mounted.current && generation.current === requestGeneration)
              setContent(completed.content);
          } catch {
            if (mounted.current && generation.current === requestGeneration)
              setDraftNotice(
                "评估已保存；参考材料暂时无法读取，可在练习记录中重新打开。",
              );
          }
        }
      }
    } catch (err) {
      // Keep answer and session for retry; a failed request never becomes a fake grade.
      if (mounted.current && generation.current === requestGeneration)
        setError(err instanceof Error ? err.message : "评估失败，请重试。");
    } finally {
      if (submitLock.current === requestSessionId) submitLock.current = null;
      if (mounted.current && generation.current === requestGeneration)
        setSubmitting(false);
    }
  };

  const revealAssistance = () => {
    setAssisted(true);
    if (
      session &&
      !sessionCache.write(`flash-assisted:${session.session_id}`, "true")
    )
      setDraftNotice(
        "辅助使用标记无法保存；本次提交仍会记录，刷新前请先完成提交。",
      );
  };
  return (
    <div className="page-stack practice-workspace space-y-6">
      <PageHeading
        eyebrow="FOCUSED PRACTICE"
        title={historyRecord ? "回到这一次思考" : "专注完成眼前的任务"}
        description={
          historyRecord
            ? "回看原始回答与具体反馈，找到下一步的练习方向。"
            : "先读清材料和交付要求，再用自己的方式表达思路。"
        }
      />
      <Link
        to="/skills"
        className="inline-flex items-center gap-2 text-muted-foreground"
      >
        <ChevronLeft size={20} />
        返回任务库
      </Link>
      <div className="panel practice-panel space-y-6">
        {loading ? (
          <div className="py-20 flex flex-col items-center gap-4">
            <Brain className="animate-pulse text-primary" size={40} />
            <p>正在准备练习...</p>
          </div>
        ) : (
          <>
            {error && (
              <div
                role="alert"
                className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg space-y-3"
              >
                <p>{error}</p>
                {!content && (
                  <button
                    className="underline"
                    onClick={() => setRevision((v) => v + 1)}
                  >
                    重试
                  </button>
                )}
                {content && !feedback && !submitting && (
                  <div className="space-y-2">
                    <p className="text-sm">
                      可先复制当前回答；放弃后旧草稿仍按原会话保留，重新出题会调用模型并产生费用。
                    </p>
                    <button
                      className="underline"
                      onClick={() => {
                        if (session)
                          sessionCache.remove(
                            `flash-session:${userId}:${session.skill_id}:${mode}:${targetKey}`,
                          );
                        setRevision((v) => v + 1);
                      }}
                    >
                      放弃本题，重新出题
                    </button>
                    <Link className="ml-4 underline" to="/skills">
                      选择其他任务
                    </Link>
                  </div>
                )}
              </div>
            )}
            {content && (
              <>
                <span className="text-sm text-primary">
                  {content.category} · {content.difficulty} ·{" "}
                  {
                    {
                      guided: "引导练习",
                      independent: "独立练习",
                      transfer: "迁移练习",
                    }[displayMode]
                  }
                </span>
                <h2 className="practice-title">{content.title}</h2>
                {/* Model text is rendered as text, never injected as executable HTML. */}
                <p className="whitespace-pre-wrap leading-relaxed text-muted-foreground">
                  {content.description}
                </p>
                {content.materials && (
                  <section className="practice-materials whitespace-pre-wrap">
                    <h2 className="font-semibold mb-2">任务材料</h2>
                    {content.materials}
                  </section>
                )}
                {session?.atom_snapshot && (
                  <details className="border rounded-lg p-4">
                    <summary className="cursor-pointer font-medium">
                      本次目标与评分依据
                    </summary>
                    {session.atom_snapshot
                      .filter(
                        (atom) =>
                          !content.target_atomic_ids?.length ||
                          content.target_atomic_ids.includes(
                            atom.atomic_skill_id,
                          ),
                      )
                      .map((atom) => (
                        <div key={atom.atomic_skill_id} className="mt-3">
                          <h3 className="font-semibold">{atom.name}</h3>
                          <p>{atom.action}</p>
                          <ul className="list-disc pl-5">
                            {atom.rubric.map((item) => (
                              <li key={item}>{item}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </details>
                )}
                {content.hint && (mode === "guided" || feedback) && (
                  <div>
                    <button
                      className="text-primary"
                      disabled={submitting}
                      onClick={() => {
                        if (!feedback) revealAssistance();
                        setShowHint((v) => !v);
                      }}
                    >
                      {showHint
                        ? "收起提示"
                        : feedback
                          ? "查看提示"
                          : "查看提示（记录辅助使用）"}
                    </button>
                    {showHint && (
                      <p className="p-4 bg-yellow-50 rounded-lg whitespace-pre-wrap">
                        {content.hint}
                      </p>
                    )}
                  </div>
                )}
                {content.example_answer && (mode === "guided" || feedback) && (
                  <div>
                    <button
                      className="text-primary"
                      disabled={submitting}
                      onClick={() => {
                        if (!feedback) revealAssistance();
                        setShowExample((v) => !v);
                      }}
                    >
                      {showExample
                        ? "收起参考答案"
                        : feedback
                          ? "查看参考答案"
                          : "查看参考答案（记录辅助使用）"}
                    </button>
                    {showExample && (
                      <p className="mt-3 p-4 bg-blue-50 rounded-lg whitespace-pre-wrap">
                        {content.example_answer}
                      </p>
                    )}
                  </div>
                )}
                {feedback ? (
                  <>
                    <div className="p-4 bg-secondary rounded-lg whitespace-pre-wrap">
                      <h2 className="font-semibold mb-2">你的回答</h2>
                      {answer}
                    </div>
                    <FeedbackPanel
                      {...feedback}
                      skillCategory={content.category}
                    />
                    {evidence.length > 0 && (
                      <section className="space-y-4">
                        <h2 className="text-xl font-semibold">原子能力证据</h2>
                        {evidence.map((item) => (
                          <article
                            key={item.atomic_skill_id}
                            className="p-4 border rounded-lg space-y-2"
                          >
                            <h3 className="font-semibold">
                              {session?.atom_snapshot?.find(
                                (atom) =>
                                  atom.atomic_skill_id === item.atomic_skill_id,
                              )?.name || item.atomic_skill_id}{" "}
                              ·{" "}
                              {item.status === "not_observable"
                                ? "本次不可观察"
                                : `本次评分 ${item.score ?? "未评分"}`}
                            </h3>
                            {item.quote && (
                              <blockquote className="border-l-4 pl-3 whitespace-pre-wrap">
                                {item.quote}
                              </blockquote>
                            )}
                            <p>{item.reason}</p>
                            <p>下一步：{item.next_action}</p>
                          </article>
                        ))}
                        <Link className="text-primary" to="/learning-curve">
                          查看情境证据档案 →
                        </Link>
                      </section>
                    )}
                    {draftNotice && (
                      <p role="status" className="text-sm text-amber-700">
                        {draftNotice}
                      </p>
                    )}
                    {historyRecord ? (
                      <Link to="/skills" className="text-primary">
                        开始新练习
                      </Link>
                    ) : (
                      <button
                        onClick={() => {
                          if (session)
                            sessionCache.remove(
                              `flash-session:${userId}:${session.skill_id}:${mode}:${targetKey}`,
                            );
                          setRevision((v) => v + 1);
                        }}
                        className="inline-flex items-center gap-2 text-primary"
                      >
                        <RefreshCw size={18} />
                        再练一道
                      </button>
                    )}
                  </>
                ) : (
                  <div className="space-y-4">
                    {mode !== "guided" && (
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={assisted}
                          disabled={submitting}
                          onChange={(event) => {
                            const value = event.target.checked;
                            setAssisted(value);
                            if (session)
                              sessionCache.write(
                                `flash-assisted:${session.session_id}`,
                                String(value),
                              );
                          }}
                        />
                        本次使用了外部提示、参考答案或他人帮助
                      </label>
                    )}
                    <label
                      htmlFor="response-text"
                      className="block font-medium"
                    >
                      请输入你的回答
                    </label>
                    <textarea
                      id="response-text"
                      value={answer}
                      onChange={(e) => {
                        setAnswer(e.target.value);
                        if (
                          session &&
                          !sessionCache.write(
                            `flash-draft:${session.session_id}`,
                            e.target.value,
                          )
                        ) {
                          setDraftNotice(
                            "草稿暂时无法保存，刷新前请复制你的回答。",
                          );
                        }
                      }}
                      maxLength={50000}
                      disabled={submitting}
                      className="practice-answer w-full min-h-56 p-4 border rounded-xl resize-y"
                      placeholder="在这里输入你的回答内容..."
                    />
                    <div className="flex items-center justify-between gap-4">
                      <span className="text-sm text-muted-foreground">
                        {answer.length} 字符
                      </span>
                      <button
                        onClick={submit}
                        disabled={!answer.trim() || submitting || !session}
                        className="button-primary disabled:opacity-50"
                      >
                        {submitting ? "正在评估..." : "提交并获取评估"}
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {mode === "guided"
                        ? "引导模式结果仅作为辅助完成证据；查看提示与示例仍需主动点击。"
                        : assisted
                          ? "本次已记录辅助使用。"
                          : "本次尚未声明辅助使用。"}{" "}
                      评估成功后保存原始回答和证据；失败可重试。
                    </p>
                    {draftNotice && (
                      <p role="status" className="text-sm text-amber-700">
                        {draftNotice}
                      </p>
                    )}
                  </div>
                )}
                {trace.length > 0 && (
                  <details className="border-t pt-4">
                    <summary className="cursor-pointer font-medium">
                      实际 Agent 执行记录
                    </summary>
                    {trace.map((item, index) => (
                      <div key={index} className="mt-3 text-sm">
                        <p className="font-medium">
                          {item.agent} · {item.method}
                        </p>
                        <p className="text-muted-foreground">{item.summary}</p>
                      </div>
                    ))}
                  </details>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default PracticeSession;
