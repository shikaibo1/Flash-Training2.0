import { BookOpen, CheckCheck, Clock3, GitBranch, Sprout } from "lucide-react";
import { Link } from "react-router-dom";
import { calculateStats, durationLabel } from "../lib/stats";
import { usePracticeRecords } from "../hooks/usePracticeRecords";
import { useAccount } from "../hooks/useAccount";
import { RecordList } from "../components/workspace/RecordList";
import {
  EmptyState,
  LoadingState,
  Notice,
  PageHeading,
  SectionHeading,
  StatCard,
  TextLink,
} from "../components/workspace/Primitives";

export default function Profile() {
  const { account } = useAccount();
  const records = usePracticeRecords();
  const stats = calculateStats(records.records);
  return (
    <div className="page-stack page-stack-wide">
      <PageHeading
        eyebrow="MY LEARNING SPACE"
        title="按自己的节奏，持续积累"
        description="从已完成的练习回看学习过程。每次独立思考，都是下一次行动的基础。"
      />
      <section className="profile-banner">
        <span className="profile-avatar">{account.display_name.slice(0, 1)}</span>
        <div>
          <span className="small-label">我的学习空间</span>
          <h2>{account.display_name}</h2>
          <p>@{account.username} · 记录尝试，连接知识，发现下一步。</p>
        </div>
        <span className="profile-streak">
          <Sprout size={17} />
          {records.isPending
            ? "读取学习记录…"
            : stats.streakDays > 0
              ? `连续练习 ${stats.streakDays} 天`
              : "今天也可以成为新的起点"}
        </span>
      </section>
      <div className="stats-grid profile-stats">
        <StatCard
          label="累计练习"
          value={records.isPending || records.isError ? "—" : stats.totalCount}
          caption="已经保存的练习记录"
          icon={BookOpen}
        />
        <StatCard
          label="记录时长"
          value={
            records.isPending || records.isError
              ? "—"
              : durationLabel(stats.totalSeconds)
          }
          caption="按任务开始与完成时间计算"
          icon={Clock3}
          tone="blue"
        />
        <StatCard
          label="独立练习"
          value={
            records.isPending || records.isError
              ? "—"
              : records.records.filter(
                  (record) =>
                    record.mode === "independent" && !record.assistance_used,
                ).length
          }
          caption="未声明辅助的独立模式练习"
          icon={CheckCheck}
          tone="amber"
        />
      </div>
      {records.isError && (
        <Notice
          onRetry={() => {
            void records.refetch();
          }}
        >
          {records.error.message}
        </Notice>
      )}
      <section className="panel">
        <SectionHeading
          title="最近练习"
          action={<TextLink to="/history">全部记录</TextLink>}
        />
        {records.isPending && <LoadingState />}
        {!records.isPending &&
          !records.isError &&
          (records.records.length ? (
            <RecordList records={records.records.slice(0, 4)} />
          ) : (
            <EmptyState
              title="从感兴趣的任务开始"
              description="先完成一次尝试，再慢慢建立自己的能力证据。"
              action={<TextLink to="/skills">选择任务</TextLink>}
            />
          ))}
      </section>
      <div className="profile-links">
        <Link className="panel" to="/graph">
          <GitBranch size={23} />
          <div>
            <h3>探索能力图谱</h3>
            <p>看看课程知识如何连接到实际行动。</p>
          </div>
        </Link>
        <Link className="panel" to="/learning-curve">
          <CheckCheck size={23} />
          <div>
            <h3>查看能力证据</h3>
            <p>根据具体情境与原始表现认识自己。</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
