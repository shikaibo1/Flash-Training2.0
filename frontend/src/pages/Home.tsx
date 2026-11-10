import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CheckCheck,
  ChevronRight,
  Clock3,
  GitBranch,
  Layers3,
  MoveUpRight,
  Shapes,
  Sparkles,
} from "lucide-react";
import { careerApi, systemApi } from "../lib/api";
import { usePracticeRecords } from "../hooks/usePracticeRecords";
import { parseTimestamp } from "../lib/stats";
import {
  EmptyState,
  LoadingState,
  ModeSelector,
  Notice,
  PageHeading,
  SectionHeading,
  StatCard,
  TextLink,
} from "../components/workspace/Primitives";

export default function Home() {
  const [mode, setMode] = useState("guided");
  const settings = { staleTime: 30000, retry: 1 };
  const graph = useQuery({
    queryKey: ["career-graph"],
    queryFn: careerApi.graph,
    ...settings,
  });
  const evidence = useQuery({
    queryKey: ["career-evidence"],
    queryFn: () => careerApi.evidence(),
    ...settings,
  });
  const suggestions = useQuery({
    queryKey: ["career-recommendations"],
    queryFn: () => careerApi.recommendations(),
    ...settings,
  });
  const history = usePracticeRecords();
  const health = useQuery({
    queryKey: ["health"],
    queryFn: systemApi.health,
    ...settings,
  });
  const measured = evidence.data?.atomic_skills.filter((atom) =>
    atom.contexts.some((context) => context.evidence_count > 0),
  ).length;
  const total = evidence.data?.atomic_skills.length;
  const coverage = total && measured != null ? measured / total : 0;
  const records = history.data?.records
    .slice()
    .sort(
      (a, b) =>
        parseTimestamp(b.end_time).getTime() -
        parseTimestamp(a.end_time).getTime(),
    )
    .slice(0, 3);

  return (
    <div className="page-stack dashboard-page">
      <PageHeading
        eyebrow="LEARNING WORKSPACE"
        title="今天，让理解更进一步。"
        description="从一次小练习开始，把学过的知识，变成真正会用的能力。"
        action={
          <span className="quiet-label">
            <span className="status-dot" />
            专注当下，循序渐进
          </span>
        }
      />
      {health.data && !health.data.ai_configured && (
        <Notice>
          AI 服务尚未配置。你仍可浏览任务和图谱，配置后即可开始练习。
        </Notice>
      )}
      {health.isError && (
        <Notice
          onRetry={() => {
            void health.refetch();
          }}
        >
          暂时无法确认服务状态，请检查本地程序是否运行。
        </Notice>
      )}
      <div className="dashboard-columns">
        <div className="dashboard-primary">
          <section className="learning-hero">
            <div className="hero-copy">
              <span className="hero-label">
                <Sparkles size={14} />
                从知识，到行动
              </span>
              <h2>
                学过的，
                <br />
                都可以再向前一步。
              </h2>
              <p>
                用任务检验理解，用证据看见变化。
                <br className="desktop-break" />
                找到下一步值得练习的能力。
              </p>
              <div className="hero-actions">
                <Link className="button-primary" to="/projects">
                  创建或继续学习目标
                  <ArrowRight size={16} />
                </Link>
                <Link className="hero-secondary" to="/graph">
                  探索能力图谱
                  <MoveUpRight size={15} />
                </Link>
              </div>
            </div>
            <div
              className="hero-diagram"
              aria-label="学习路径示意：课程知识、原子能力、任务实践"
            >
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="diagram-node node-knowledge">
                <BookOpen size={19} />
                <span>
                  <small>连接已学</small>课程知识
                </span>
              </div>
              <div className="diagram-node node-atom">
                <Shapes size={22} />
                <span>
                  <small>拆解行动</small>原子能力
                </span>
              </div>
              <div className="diagram-node node-task">
                <CheckCheck size={19} />
                <span>
                  <small>检验理解</small>任务实践
                </span>
              </div>
              <span className="diagram-caption">一步一步，把知识连接起来</span>
            </div>
          </section>
          <div className="stats-grid">
            <StatCard
              label="可练习任务"
              value={graph.data?.tasks.length ?? "—"}
              caption="从具体交付物出发"
              icon={BookOpen}
            />
            <StatCard
              label="原子能力"
              value={graph.data?.atoms.length ?? "—"}
              caption="看清任务需要哪些能力"
              icon={Layers3}
              tone="blue"
            />
            <StatCard
              label="已观察原子"
              value={measured ?? "—"}
              caption="已积累表现证据的能力"
              icon={CheckCheck}
              tone="amber"
            />
          </div>
          {(graph.isError || evidence.isError) && (
            <Notice
              onRetry={() => {
                void graph.refetch();
                void evidence.refetch();
              }}
            >
              部分学习数据暂时无法读取。
            </Notice>
          )}
          <section className="section-block">
            <SectionHeading
              title="下一步，练什么？"
              description="根据已有表现与能力关系，为你找到练习起点。"
              action={<TextLink to="/skills">全部任务</TextLink>}
            />
            <ModeSelector value={mode} onChange={setMode} />
            {suggestions.isPending && (
              <LoadingState label="正在整理练习建议…" />
            )}
            {suggestions.isError && (
              <Notice
                onRetry={() => {
                  void suggestions.refetch();
                }}
              >
                {suggestions.error.message}
              </Notice>
            )}
            {suggestions.data?.recommendations.length === 0 && (
              <EmptyState
                title="从感兴趣的任务开始"
                description="当前没有推荐，任务库里的练习随时可以尝试。"
                action={<TextLink to="/skills">选择一个任务</TextLink>}
              />
            )}
            <div className="recommendation-list">
              {suggestions.data?.recommendations
                .slice(0, 3)
                .map((item, index) => (
                  <Link
                    key={item.skill_id}
                    className="recommendation-card"
                    to={`/practice/${encodeURIComponent(item.skill_id)}?mode=${mode}&atoms=${encodeURIComponent(item.target_atomic_ids.join(","))}`}
                  >
                    <span className="recommendation-number">0{index + 1}</span>
                    <div className="recommendation-copy">
                      <span className="small-label">{item.context}</span>
                      <h3>{item.title}</h3>
                      <p>{item.reason}</p>
                    </div>
                    <span className="recommendation-arrow">
                      <ArrowRight size={19} />
                    </span>
                  </Link>
                ))}
            </div>
          </section>
          <section className="panel activity-panel">
            <SectionHeading
              title="最近的尝试"
              action={<TextLink to="/history">全部记录</TextLink>}
            />
            {history.isPending && <LoadingState />}
            {history.isError && (
              <Notice
                onRetry={() => {
                  void history.refetch();
                }}
              >
                {history.error.message}
              </Notice>
            )}
            {records?.length === 0 && (
              <EmptyState
                icon={Clock3}
                title="你的第一条记录，从这里开始"
                description="完成一次练习后，回答和反馈会留在这里，方便随时回顾。"
                action={<TextLink to="/skills">去练习</TextLink>}
              />
            )}
            {records?.map((record) => (
              <Link
                className="activity-row"
                key={record.record_id || record.session_id}
                to={`/practice/${encodeURIComponent(record.skill_id)}`}
                state={{ fromHistory: true, record }}
              >
                <span className="icon-tile green">
                  <BookOpen size={17} />
                </span>
                <div>
                  <h3>{record.title || record.skill_name}</h3>
                  <p>
                    {record.context || record.category} ·{" "}
                    {parseTimestamp(record.end_time).toLocaleDateString(
                      "zh-CN",
                    )}
                  </p>
                </div>
                <strong>
                  {record.score}
                  <small> / 100</small>
                </strong>
                <ChevronRight size={16} />
              </Link>
            ))}
          </section>
        </div>
        <aside className="dashboard-aside">
          <section className="panel coverage-panel">
            <span className="small-label">我的能力观察</span>
            <h2>让进步，有迹可循。</h2>
            <div className="coverage-ring">
              <svg viewBox="0 0 140 140" aria-hidden="true">
                <circle
                  cx="70"
                  cy="70"
                  r="59"
                  fill="none"
                  stroke="#edf1ed"
                  strokeWidth="8"
                />
                <circle
                  cx="70"
                  cy="70"
                  r="59"
                  fill="none"
                  stroke="#3f7662"
                  strokeWidth="8"
                  strokeLinecap="round"
                  strokeDasharray={`${coverage * 370.7} 370.7`}
                  transform="rotate(-90 70 70)"
                />
              </svg>
              <div>
                <strong>
                  {measured ?? "—"}
                  <small> / {total ?? "—"}</small>
                </strong>
                <span>已观察原子</span>
              </div>
            </div>
            <p>
              {measured
                ? "每条证据都关联具体场景，点开看看自己的表现。"
                : "不急着给自己打分，先从一次真实的尝试开始。"}
            </p>
            <Link className="button-secondary" to="/learning-curve">
              查看能力证据
              <ArrowRight size={15} />
            </Link>
            <small className="coverage-note">
              这里呈现观察覆盖情况，不代表掌握程度。
            </small>
          </section>
          <section className="panel path-panel">
            <span className="small-label">找到适合你的节奏</span>
            <h2>一次练习，三种方式。</h2>
            <div className="path-step">
              <span>01</span>
              <div>
                <h3>有帮助地开始</h3>
                <p>查看思路与示例，先建立理解。</p>
              </div>
            </div>
            <div className="path-step">
              <span>02</span>
              <div>
                <h3>独立完成一次</h3>
                <p>收起提示，检验自己的思考。</p>
              </div>
            </div>
            <div className="path-step">
              <span>03</span>
              <div>
                <h3>换个情境再试</h3>
                <p>用新的案例，观察能力的适用范围。</p>
              </div>
            </div>
            <Link className="text-link" to="/graph">
              看看能力如何连接
              <GitBranch size={15} />
            </Link>
          </section>
          <div className="aside-caption">
            <span>小步练习，持续积累。</span>
            <p>
              每一条“尚未观察”，
              <br />
              都是一个可以探索的起点。
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
