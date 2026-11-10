import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  FileText,
  GitCompareArrows,
  Info,
  Layers3,
  Mail,
  Network,
  Table2,
} from "lucide-react";
import { bridgeApi, practiceApi } from "../lib/api";
import { bridgePracticeUrl, bridgeStages, practiceModes } from "../lib/bridge";
import type { BridgeCatalog } from "../lib/bridge";
import type { PracticeRecord } from "../types";

const stagePresentation = {
  baseline: {
    icon: Table2,
    label: "建立起点",
    summary: "从表格提取事实，核算指标，留下一次基线作答。",
    color: "violet",
  },
  representation: {
    icon: Mail,
    label: "换种表达",
    summary: "同一组数据换成业务邮件，试着重新找到关键信息。",
    color: "blue",
  },
  boundary: {
    icon: GitCompareArrows,
    label: "识别边界",
    summary: "当观察窗口发生变化，判断哪些结论仍然成立。",
    color: "amber",
  },
  synthesis: {
    icon: FileText,
    label: "完整交付",
    summary: "把事实、计算、局限与建议，组织成一份分析便笺。",
    color: "green",
  },
};

export default function Bridge() {
  const [params, setParams] = useSearchParams();
  const sourceId = params.get("source_session_id") || "";
  const [catalog, setCatalog] = useState<BridgeCatalog | null>(null);
  const [baselines, setBaselines] = useState<PracticeRecord[]>([]);
  const [modes, setModes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [recordsError, setRecordsError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    bridgeApi
      .catalog()
      .then((result) => {
        if (active) {
          setCatalog(result.data);
          setError("");
        }
      })
      .catch((err) => {
        if (active)
          setError(err instanceof Error ? err.message : "训练路径读取失败");
      });
    practiceApi
      .getRecords()
      .then((result) => {
        if (active) {
          setBaselines(
            result.records.filter(
              (record) =>
                record.bridge_case_id === "conversion_baseline" &&
                record.session_id,
            ),
          );
          setRecordsError("");
        }
      })
      .catch((err) => {
        if (active)
          setRecordsError(
            err instanceof Error ? err.message : "基线记录读取失败",
          );
      });
    return () => {
      active = false;
    };
  }, [revision]);

  const selectedSource = baselines.find(
    (record) => record.session_id === sourceId,
  );
  return (
    <div className="page-stack bridge-page">
      <div className="page-topline">
        <span>学习空间 / 迁移训练</span>
        <Link to="/graph" className="text-link">
          <Network size={15} aria-hidden="true" /> 能力图谱{" "}
          <ArrowUpRight size={14} aria-hidden="true" />
        </Link>
      </div>
      <section className="bridge-intro">
        <div className="bridge-heading">
          <span className="section-kicker">
            <span className="status-dot" /> 专题 · 核对活动转化简报
          </span>
          <h1>{catalog?.title || "从原子练习到工作交付"}</h1>
          <p>
            {catalog?.description ||
              "围绕同一个工作任务，在变化的条件中理解、尝试和交付。"}
          </p>
        </div>
        <div className="bridge-intro-note">
          <Layers3 size={24} strokeWidth={1.5} aria-hidden="true" />
          <span>
            先看条件，再做判断。<small>每次作答，都留下可回看的依据。</small>
          </span>
        </div>
      </section>
      {error && (
        <p role="alert" className="notice-panel">
          {error}{" "}
          <button
            className="text-link"
            onClick={() => setRevision((value) => value + 1)}
          >
            重试
          </button>
        </p>
      )}
      {!catalog && !error && (
        <p role="status" className="empty-panel">
          正在读取训练路径…
        </p>
      )}
      {catalog && (
        <nav className="training-roadmap" aria-label="训练环节导航">
          {catalog.cases.map((trainingCase, index) => {
            const stage = stagePresentation[trainingCase.stage];
            const Icon = stage.icon;
            return (
              <a
                key={trainingCase.case_id}
                href={`#${trainingCase.case_id}`}
                className={`roadmap-stop stage-${stage.color}`}
              >
                <span className="roadmap-number">0{index + 1}</span>
                <span className="roadmap-icon">
                  <Icon size={21} strokeWidth={1.6} aria-hidden="true" />
                </span>
                <strong>{bridgeStages[trainingCase.stage]}</strong>
                <small>{stage.label}</small>
              </a>
            );
          })}
        </nav>
      )}
      <section className="baseline-panel">
        <div>
          <span className="eyebrow">OPTIONAL / 可选</span>
          <h2>
            <GitCompareArrows size={19} aria-hidden="true" />{" "}
            关联一次基线，观察前后表现
          </h2>
          <p>
            所有环节都可直接尝试。关联已完成的基线后，变式将提供配对观察；使用辅助时会单独标记。
          </p>
        </div>
        <div className="baseline-control">
          <label htmlFor="bridge-source">用于配对的基线会话</label>
          <select
            id="bridge-source"
            value={sourceId}
            onChange={(event) =>
              setParams(
                event.target.value
                  ? { source_session_id: event.target.value }
                  : {},
              )
            }
          >
            <option value="">不关联基线（只记录本次作答）</option>
            {sourceId && !selectedSource && (
              <option value={sourceId}>
                当前链接指定的基线（等待服务核验）
              </option>
            )}
            {baselines.map((record) => (
              <option key={record.session_id} value={record.session_id}>
                {record.title || record.skill_name} · {record.start_time} ·{" "}
                {record.score} 分 ·{" "}
                {record.assistance_used || record.mode === "guided"
                  ? "使用辅助"
                  : "未声明辅助"}
              </option>
            ))}
          </select>
          {selectedSource && (
            <Link
              className="text-link mt-2"
              to={`/practice/${encodeURIComponent(selectedSource.skill_id)}?session_id=${encodeURIComponent(sourceId)}&bridge_case_id=${encodeURIComponent(selectedSource.bridge_case_id || "")}`}
            >
              查看此基线的原始回答和诊断{" "}
              <ArrowUpRight size={14} aria-hidden="true" />
            </Link>
          )}
          {recordsError && (
            <p role="alert" className="text-sm mt-2 text-red-700">
              基线列表读取失败：{recordsError}{" "}
              <button
                className="text-link"
                onClick={() => setRevision((value) => value + 1)}
              >
                重试
              </button>
            </p>
          )}
        </div>
      </section>
      {catalog && (
        <section className="space-y-5" aria-labelledby="training-cases-heading">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PRACTICE & TRANSFER</span>
              <h2 id="training-cases-heading">选择你的下一次尝试</h2>
            </div>
            <span className="text-xs text-muted-foreground">
              按需选择 · 无解锁限制
            </span>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            {catalog.cases.map((trainingCase, index) => {
              const mode =
                modes[trainingCase.case_id] ||
                (trainingCase.allowed_modes.includes("independent")
                  ? "independent"
                  : trainingCase.allowed_modes[0]);
              const canStart =
                !trainingCase.requires_source || Boolean(sourceId);
              const stage = stagePresentation[trainingCase.stage];
              const Icon = stage.icon;
              return (
                <article
                  id={trainingCase.case_id}
                  key={trainingCase.case_id}
                  className={`training-card stage-${stage.color}`}
                >
                  <div className="training-card-top">
                    <span className="training-icon">
                      <Icon size={24} strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <span className="training-stage">{stage.label}</span>
                    <span className="training-number">0{index + 1}</span>
                  </div>
                  <h3>{trainingCase.title}</h3>
                  <p className="training-summary">{stage.summary}</p>
                  <div className="changed-condition">
                    <span>本题改变什么</span>
                    <p>{trainingCase.changed_condition}</p>
                  </div>
                  <details className="training-details">
                    <summary>
                      查看完整任务与保留条件{" "}
                      <ChevronDown size={15} aria-hidden="true" />
                    </summary>
                    <p>{trainingCase.description}</p>
                    <h4>本题保持什么</h4>
                    <ul>
                      {trainingCase.controlled_conditions.map((condition) => (
                        <li key={condition}>
                          <Check size={13} aria-hidden="true" />
                          {condition}
                        </li>
                      ))}
                    </ul>
                  </details>
                  <div className="training-card-footer">
                    <div className="training-controls">
                      <label htmlFor={`mode-${trainingCase.case_id}`}>
                        作答方式
                      </label>
                      <select
                        id={`mode-${trainingCase.case_id}`}
                        value={mode}
                        onChange={(event) =>
                          setModes((current) => ({
                            ...current,
                            [trainingCase.case_id]: event.target.value,
                          }))
                        }
                      >
                        {trainingCase.allowed_modes.map((allowed) => (
                          <option key={allowed} value={allowed}>
                            {practiceModes[allowed] || allowed}
                          </option>
                        ))}
                      </select>
                    </div>
                    {canStart ? (
                      <Link
                        className="action-primary"
                        to={bridgePracticeUrl(
                          catalog.skill_id,
                          trainingCase.case_id,
                          mode,
                          trainingCase.target_atomic_ids,
                          trainingCase.stage === "representation" ||
                            trainingCase.stage === "boundary"
                            ? sourceId || undefined
                            : undefined,
                        )}
                      >
                        开始{bridgeStages[trainingCase.stage]}{" "}
                        <ArrowRight size={16} aria-hidden="true" />
                      </Link>
                    ) : (
                      <p className="text-sm text-amber-700">
                        请选择一个已完成的基线。
                      </p>
                    )}
                  </div>
                  <p className="training-mode-note">
                    {mode === "guided"
                      ? "可主动查看提示与示例，结果记为辅助完成。"
                      : "先独立作答；使用外部提示或他人帮助时，请主动声明。"}
                  </p>
                </article>
              );
            })}
          </div>
        </section>
      )}
      {catalog && (
        <section className="training-limitations">
          <Info size={20} aria-hidden="true" />
          <div>
            <h2>如何理解这些观察</h2>
            <p>
              规则诊断与交付物评分分别保存。设计上的受控变式，不代表已经验证题目等难；单次结果不能确定认知缺陷。
            </p>
            <ul>
              {catalog.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
