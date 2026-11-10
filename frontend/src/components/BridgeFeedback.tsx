import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { bridgeApi } from "../lib/api";
import { bridgePracticeUrl, bridgeStages } from "../lib/bridge";
import type { BridgeSession } from "../lib/bridge";

type Props = {
  sessionId: string;
  completed: boolean;
  assistanceUsed: boolean;
  atomicNames?: Record<string, string>;
};
const comparisonLabels = {
  pending: "等待完成",
  unpaired: "尚未配对",
  assisted: "含辅助使用",
  not_comparable: "本次不能直接比较",
  comparable: "已有成对观察",
};
const findingLabels = {
  supported: "本次探针支持这一假设",
  refuted: "本次探针不支持这一假设",
  insufficient: "证据仍不足",
};

export default function BridgeFeedback({
  sessionId,
  completed,
  assistanceUsed,
  atomicNames = {},
}: Props) {
  const [details, setDetails] = useState<BridgeSession | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const saveLock = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let active = true;
    setLoading(true);
    setError("");
    bridgeApi
      .session(sessionId)
      .then((result) => {
        if (!active) return;
        setDetails(result.data);
        if (result.data.diagnosis.result)
          setAnswers(result.data.diagnosis.result.answers);
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : "迁移观察读取失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, [sessionId, completed, revision]);

  const save = async () => {
    if (
      !details ||
      saveLock.current ||
      !details.diagnosis.probes.every((probe) => answers[probe.probe_id])
    )
      return;
    saveLock.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await bridgeApi.diagnose(sessionId, answers);
      if (mounted.current) {
        setDetails(result.data);
        setAnswers(result.data.diagnosis.result?.answers || answers);
      }
    } catch (err) {
      if (mounted.current)
        setError(err instanceof Error ? err.message : "诊断保存失败，请重试");
    } finally {
      saveLock.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const diagnosis = details?.diagnosis;
  const result = diagnosis?.result;
  const assistanceText = completed
    ? loading
      ? "正在读取保存记录…"
      : details?.assistance_used === true
        ? "本次已记录辅助使用（含引导模式）"
        : details?.assistance_used === false
          ? "本次保存记录为无辅助"
          : "保存的辅助记录不足，无法确定"
    : assistanceUsed
      ? "本次已标记辅助使用（含引导模式）"
      : "本次尚未声明辅助使用（提交前可调整）";
  return (
    <section className="surface-panel p-4 sm:p-6 space-y-5 bg-background text-sm leading-relaxed">
      <div>
        <span className="eyebrow">REFLECT & REVIEW</span>
        <h2 className="text-xl font-semibold mt-1">迁移训练条件与观察</h2>
      </div>
      {loading && (
        <p role="status">正在读取训练条件{completed ? "、配对与诊断" : ""}…</p>
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}{" "}
          <button
            className="underline"
            disabled={saving}
            onClick={() => setRevision((value) => value + 1)}
          >
            重新读取
          </button>
        </p>
      )}
      {details && (
        <>
          <p className="font-medium">
            {bridgeStages[details.case.stage]} · {details.case.title}
          </p>
          <dl className="text-sm space-y-2">
            <div>
              <dt className="font-semibold">改变的条件</dt>
              <dd>{details.case.changed_condition}</dd>
            </div>
            <div>
              <dt className="font-semibold">保持的条件</dt>
              <dd>
                <ul className="list-disc pl-5">
                  {details.case.controlled_conditions.map((condition) => (
                    <li key={condition}>{condition}</li>
                  ))}
                </ul>
              </dd>
            </div>
          </dl>
          <p className="text-sm">
            辅助状态：{assistanceText}。题目等难性尚未验证。
          </p>
          {!completed && (
            <p className="text-sm text-muted-foreground">
              完成交付物后才读取成对分数观察与规则诊断，不展示未发生的差异。
            </p>
          )}
          {completed && !loading && (
            <>
              <div className="border-t pt-4 space-y-3">
                <h3 className="font-semibold">
                  成对观察 · {comparisonLabels[details.comparison.status]}
                </h3>
                <p>{details.comparison.reason}</p>
                {details.comparison.status === "comparable" &&
                  details.comparison.atoms.length > 0 && (
                    <div className="overflow-x-auto">
                      <p className="text-xs text-muted-foreground mb-2">
                        以下为原子能力原始评分（0–10分），分差仅描述本次配对。
                      </p>
                      <table className="w-full text-sm text-left">
                        <thead>
                          <tr className="border-b">
                            <th className="p-2">原子能力</th>
                            <th className="p-2">基线评分</th>
                            <th className="p-2">本次评分</th>
                            <th className="p-2">本次 − 基线</th>
                          </tr>
                        </thead>
                        <tbody>
                          {details.comparison.atoms.map((atom) => (
                            <tr key={atom.atomic_skill_id} className="border-b">
                              <th className="p-2 font-medium">
                                {atomicNames[atom.atomic_skill_id] ||
                                  atom.atomic_skill_id}
                              </th>
                              <td className="p-2">{atom.baseline_score}</td>
                              <td className="p-2">{atom.current_score}</td>
                              <td className="p-2">
                                {atom.difference > 0 ? "+" : ""}
                                {atom.difference}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                <ul className="list-disc pl-5 text-sm text-muted-foreground">
                  {details.comparison.limitations.map((limitation) => (
                    <li key={limitation}>{limitation}</li>
                  ))}
                </ul>
              </div>
              {diagnosis && (
                <div className="border-t pt-4 space-y-4">
                  <h3 className="font-semibold">错误原因假设与规则探针</h3>
                  <p className="text-sm text-muted-foreground">
                    {diagnosis.message}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    模型评分描述交付物表现；以下选择题独立记录规则证据，不修改模型分数，也不能确定认知缺陷。
                  </p>
                  {diagnosis.hypotheses.length > 0 && (
                    <ul className="list-disc pl-5 text-sm">
                      {diagnosis.hypotheses.map((hypothesis) => (
                        <li key={hypothesis.hypothesis_id}>
                          {hypothesis.statement}
                        </li>
                      ))}
                    </ul>
                  )}
                  {diagnosis.status !== "unavailable" &&
                    diagnosis.probes.map((probe, index) => (
                      <fieldset
                        key={probe.probe_id}
                        disabled={saving || Boolean(result)}
                        className="border rounded-lg p-4 bg-card space-y-3"
                      >
                        <legend className="font-medium px-1">
                          {index + 1}. {probe.question}
                        </legend>
                        {probe.options.map((option) => (
                          <label
                            key={option.option_id}
                            className="diagnosis-option flex items-start gap-3 text-sm cursor-pointer"
                          >
                            <input
                              className="mt-1"
                              type="radio"
                              name={`${sessionId}-${probe.probe_id}`}
                              value={option.option_id}
                              checked={
                                answers[probe.probe_id] === option.option_id
                              }
                              onChange={() =>
                                setAnswers((current) => ({
                                  ...current,
                                  [probe.probe_id]: option.option_id,
                                }))
                              }
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </fieldset>
                    ))}
                  {diagnosis.status === "available" && !result && (
                    <div className="space-y-2">
                      <button
                        disabled={
                          saving ||
                          !diagnosis.probes.length ||
                          !diagnosis.probes.every(
                            (probe) => answers[probe.probe_id],
                          )
                        }
                        onClick={save}
                        className="action-primary"
                      >
                        {saving ? "正在保存…" : "提交规则诊断"}
                      </button>
                      <p className="text-xs text-muted-foreground">
                        全部作答后提交；保存后的答案固定，可从练习记录重新打开。
                      </p>
                    </div>
                  )}
                  {result && (
                    <div className="space-y-4">
                      <p role="status" className="text-sm text-primary">
                        规则诊断已保存，已恢复提交时的选择。
                      </p>
                      {result.findings.map((finding) => (
                        <article
                          key={finding.hypothesis_id}
                          className="bg-card border rounded-lg p-4 space-y-2"
                        >
                          <h4 className="font-medium">
                            {atomicNames[finding.atomic_skill_id] ||
                              finding.atomic_skill_id}{" "}
                            · {findingLabels[finding.status]}
                          </h4>
                          <p className="text-sm">
                            探针作答：
                            {finding.correct
                              ? "符合本题规则"
                              : "未符合本题规则"}
                          </p>
                          <p className="text-sm">{finding.explanation}</p>
                        </article>
                      ))}
                      {result.recommendations.length > 0 && (
                        <h4 className="font-semibold">
                          根据本次规则证据安排下一步
                        </h4>
                      )}
                      {result.recommendations.map((recommendation, index) => (
                        <article
                          key={`${recommendation.atomic_skill_id}-${index}`}
                          className="border rounded-lg p-4 space-y-2"
                        >
                          <p>{recommendation.reason}</p>
                          <p className="text-sm text-muted-foreground">
                            相关课程：
                            {recommendation.courses.join("、") || "未指定课程"}
                          </p>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <Link
                              className="text-primary"
                              to={`/graph?node=${encodeURIComponent(`atom:${recommendation.atomic_skill_id}`)}`}
                            >
                              查看条件化定义
                            </Link>
                            {recommendation.knowledge_ids.map((knowledgeId) => (
                              <Link
                                key={knowledgeId}
                                className="text-primary"
                                to={`/graph?node=${encodeURIComponent(`knowledge:${knowledgeId}`)}`}
                              >
                                课程知识 {knowledgeId}
                              </Link>
                            ))}
                            <Link
                              className="text-primary"
                              to={bridgePracticeUrl(
                                recommendation.practice.skill_id,
                                recommendation.practice.params.bridge_case_id,
                                recommendation.practice.params.mode,
                                recommendation.practice.params
                                  .target_atomic_ids,
                              )}
                            >
                              重新练习相应规则 →
                            </Link>
                          </div>
                        </article>
                      ))}
                      <ul className="list-disc pl-5 text-sm text-muted-foreground">
                        {result.limitations.map((limitation) => (
                          <li key={limitation}>{limitation}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
              <Link
                className="inline-block text-primary font-medium"
                to={`/bridge${details.case.stage === "baseline" ? `?source_session_id=${encodeURIComponent(sessionId)}` : details.source_session_id ? `?source_session_id=${encodeURIComponent(details.source_session_id)}` : ""}`}
              >
                返回训练路径，选择下一步 →
              </Link>
            </>
          )}
        </>
      )}
    </section>
  );
}
