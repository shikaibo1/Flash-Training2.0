import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCheck,
  ClipboardCheck,
  Layers3,
  Search,
  Shuffle,
} from "lucide-react";
import { careerApi } from "../lib/api";
import type { EvidenceData } from "../types";
import { statusLabels } from "../lib/evidence";
import { findingLabels } from "../types/projects";
import {
  EmptyState,
  LoadingState,
  Notice,
  PageHeading,
  SectionHeading,
  StatCard,
  TextLink,
} from "../components/workspace/Primitives";

export default function LearningCurve() {
  const [evidence, setEvidence] = useState<EvidenceData | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [onlyObserved, setOnlyObserved] = useState(false);
  useEffect(() => {
    let active = true;
    careerApi
      .evidence()
      .then((value) => {
        if (active) setEvidence(value);
      })
      .catch((err) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  const observed = evidence?.atomic_skills.filter((atom) =>
    atom.contexts.some((context) => context.evidence_count > 0),
  );
  const independent = evidence?.atomic_skills.filter((atom) =>
    atom.contexts.some((context) => context.status === "independent"),
  );
  const transferred = evidence?.atomic_skills.filter(
    (atom) => atom.transfer_observed,
  );
  const filtered = evidence?.atomic_skills.filter(
    (atom) =>
      atom.name.toLowerCase().includes(query.toLowerCase()) &&
      (!onlyObserved ||
        atom.contexts.some((context) => context.evidence_count > 0)),
  );
  return (
    <div className="page-stack page-stack-wide">
      <PageHeading
        eyebrow="EVIDENCE & REFLECTION"
        title="看见自己的能力，凭的是证据"
        description="每次表现都属于具体情境。回看回答、帮助与反馈，分清“做过一次”和“能够独立完成”。"
        action={<TextLink to="/skills">继续一次练习</TextLink>}
      />
      <div className="stats-grid evidence-stats">
        <StatCard
          label="已有观察"
          value={observed?.length ?? "—"}
          caption="至少有一条可观察证据的原子"
          icon={Layers3}
        />
        <StatCard
          label="独立完成"
          value={independent?.length ?? "—"}
          caption="当前至少一个情境有独立表现"
          icon={CheckCheck}
          tone="blue"
        />
        <StatCard
          label="跨情境观察"
          value={transferred?.length ?? "—"}
          caption="不同情境下的独立达标证据"
          icon={Shuffle}
          tone="amber"
        />
      </div>
      {error && (
        <Notice
          onRetry={() => {
            setError("");
            setRevision((value) => value + 1);
          }}
        >
          {error}
        </Notice>
      )}
      {!evidence && !error && <LoadingState />}
      {evidence && (
        <>
          {(evidence.project_observations?.length ?? 0) > 0 && (
            <section className="panel p-6">
              <SectionHeading
                title="学习项目 · 判断依据"
                description="不换算虚假的掌握分数；追问与使用帮助的表现单独标记。"
              />
              <div className="project-observations">
                {evidence.project_observations?.map((o) => (
                  <article key={o.observation_id}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <strong>
                        {
                          evidence.atomic_skills.find(
                            (a) => a.atomic_skill_id === o.atomic_skill_id,
                          )?.name
                        }{" "}
                        · {findingLabels[o.finding.state]}
                      </strong>
                      <small>
                        {o.stage === "probe"
                          ? "追问"
                          : o.stage === "verification"
                            ? "新题复测"
                            : "初次尝试"}{" "}
                        · {o.assistance_used ? "使用帮助" : "未报告帮助"}
                      </small>
                    </div>
                    <p>{o.finding.reason}</p>
                    {o.finding.quote && (
                      <blockquote>“{o.finding.quote}”</blockquote>
                    )}
                    <p className="text-muted-foreground">
                      下一步：{o.finding.next_action}
                    </p>
                    <Link
                      className="text-primary"
                      to={`/projects/${o.project_id}`}
                    >
                      查看原始回答与学习过程 →
                    </Link>
                  </article>
                ))}
              </div>
            </section>
          )}
          {observed?.length === 0 && (
            <div className="evidence-welcome">
              <span className="empty-icon">
                <ClipboardCheck size={25} />
              </span>
              <div>
                <h2>还没有观察，也是一种清晰的起点。</h2>
                <p>完成一次任务后，系统会把表现、引用与改进建议保存在这里。</p>
              </div>
              <Link className="button-primary" to="/skills">
                选择任务
                <ArrowRight size={15} />
              </Link>
            </div>
          )}
          <section className="evidence-section">
            <SectionHeading
              title="我的原子能力"
              description="同一能力在不同情境分别记录，不直接沿用其他场景的得分。"
            />
            <div className="evidence-toolbar">
              <div className="library-search">
                <Search size={16} />
                <input
                  aria-label="搜索原子能力"
                  placeholder="查找某项能力"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={onlyObserved}
                  onChange={(event) => setOnlyObserved(event.target.checked)}
                />
                只看已有观察
              </label>
            </div>
            {filtered?.length === 0 && (
              <EmptyState
                title="暂无匹配的能力证据"
                description="调整搜索条件，或完成一次任务后再来看看。"
              />
            )}
            <div className="evidence-grid">
              {filtered?.map((atom) => (
                <article className="evidence-card" key={atom.atomic_skill_id}>
                  <div className="evidence-card-heading">
                    <Link
                      to={`/graph?node=${encodeURIComponent(`atom:${atom.atomic_skill_id}`)}`}
                    >
                      {atom.name}
                    </Link>
                    <span
                      className={`evidence-tag ${atom.transfer_observed ? "independent" : "unmeasured"}`}
                    >
                      {atom.transfer_observed ? "跨情境已观察" : "迁移待观察"}
                    </span>
                  </div>
                  <div className="context-list">
                    {atom.contexts.map((context) => (
                      <div key={context.context} className="context-row">
                        <span>{context.context}</span>
                        <span className={`evidence-tag ${context.status}`}>
                          {statusLabels[context.status]}
                        </span>
                        <strong>
                          {context.last_score == null
                            ? "—"
                            : context.last_score}
                          <small>
                            {context.last_score == null ? "" : " /10"}
                          </small>
                        </strong>
                        <small className="context-count">
                          {context.evidence_count} 条证据
                        </small>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
          <section className="evidence-section">
            <SectionHeading
              title="最近的观察依据"
              description="分数背后，保留你的原始表达和下一步可以采取的行动。"
            />
            {evidence.recent_evidence.length === 0 && (
              <EmptyState
                title="这里将记录你的思考"
                description="一次练习后，就能回看具体原子能力的评估依据。"
                icon={ClipboardCheck}
              />
            )}
            <div className="evidence-observations">
              {evidence.recent_evidence.map((item, index) => (
                <article
                  className="observation-card"
                  key={`${item.session_id}-${item.atomic_skill_id}-${index}`}
                >
                  <div className="observation-heading">
                    <span className="small-label">
                      {item.context} ·{" "}
                      {item.assistance_used ? "使用了辅助" : "未声明辅助"}
                    </span>
                    <span className="observation-score">
                      {item.status === "not_observable"
                        ? "本次不可观察"
                        : `${item.score ?? "—"} / 10`}
                    </span>
                  </div>
                  <h3>
                    {evidence.atomic_skills.find(
                      (atom) => atom.atomic_skill_id === item.atomic_skill_id,
                    )?.name || item.atomic_skill_id}
                  </h3>
                  {item.quote && <blockquote>{item.quote}</blockquote>}
                  <p>{item.reason}</p>
                  <div className="next-action">
                    <ArrowRight size={15} />
                    <span>{item.next_action}</span>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
