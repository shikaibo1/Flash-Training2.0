import { useState } from "react";
import { ClipboardList, Search } from "lucide-react";
import { practiceApi } from "../lib/api";
import type { PracticeRecord } from "../types";
import { usePracticeRecords } from "../hooks/usePracticeRecords";
import { RecordList } from "../components/workspace/RecordList";
import {
  EmptyState,
  LoadingState,
  Notice,
  PageHeading,
  TextLink,
} from "../components/workspace/Primitives";

export default function PracticeHistory() {
  const records = usePracticeRecords();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const filtered = records.records.filter(
    (record) =>
      (!mode || record.mode === mode) &&
      `${record.title} ${record.skill_name} ${record.context} ${record.category}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const deleteRecord = async (record: PracticeRecord) => {
    if (
      !record.record_id ||
      !window.confirm("移除这条练习记录？已积累的能力证据仍会保留。")
    )
      return;
    setDeletingId(record.record_id);
    setDeleteError("");
    try {
      await practiceApi.deleteRecord(record.record_id);
      window.dispatchEvent(new CustomEvent("practice:record-deleted"));
    } catch (error) {
      setDeleteError(
        error instanceof Error ? error.message : "删除失败，请重试。",
      );
    } finally {
      setDeletingId(null);
    }
  };
  return (
    <div className="page-stack page-stack-wide">
      <PageHeading
        eyebrow="PRACTICE JOURNAL"
        title="每次尝试，都值得回看"
        description="回到当时的任务、回答与反馈，看见自己的思考如何变化。"
        action={<TextLink to="/skills">开始新练习</TextLink>}
      />
      <div className="library-toolbar">
        <div className="library-search">
          <Search size={16} />
          <input
            aria-label="搜索练习记录"
            placeholder="搜索任务、标题或情境"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="练习方式筛选"
          value={mode}
          onChange={(event) => setMode(event.target.value)}
        >
          <option value="">全部练习方式</option>
          <option value="guided">引导练习</option>
          <option value="independent">独立练习</option>
          <option value="transfer">迁移练习</option>
        </select>
        <span className="quiet-label">{filtered.length} 条记录</span>
      </div>
      {records.isPending && <LoadingState />}
      {records.isError && (
        <Notice
          onRetry={() => {
            void records.refetch();
          }}
        >
          {records.error.message}
        </Notice>
      )}
      {deleteError && <Notice>{deleteError}</Notice>}
      {!records.isPending && !records.isError && (
        <section className="panel history-panel">
          {filtered.length ? (
            <RecordList
              records={filtered}
              onDelete={(record) => {
                void deleteRecord(record);
              }}
              deletingId={deletingId}
            />
          ) : (
            <EmptyState
              icon={ClipboardList}
              title={
                records.records.length
                  ? "没有找到匹配记录"
                  : "你的练习旅程，从第一次尝试开始"
              }
              description={
                records.records.length
                  ? "换个关键词或练习方式再试。"
                  : "完成一次任务后，原始回答和评估反馈会保存在这里。"
              }
              action={<TextLink to="/skills">浏览任务库</TextLink>}
            />
          )}
        </section>
      )}
    </div>
  );
}
