import { ArrowUpRight, BookOpen, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { PracticeRecord } from "../../types";
import { parseTimestamp, durationLabel } from "../../lib/stats";

export function RecordList({
  records,
  onDelete,
  deletingId,
}: {
  records: PracticeRecord[];
  onDelete?: (record: PracticeRecord) => void;
  deletingId?: string | null;
}) {
  return (
    <div className="record-list">
      {records.map((record, index) => {
        const duration = Math.max(
          0,
          (parseTimestamp(record.end_time).getTime() -
            parseTimestamp(record.start_time).getTime()) /
            1000,
        );
        return (
          <article
            className="record-row"
            key={record.record_id || record.session_id || index}
          >
            <span className="icon-tile green">
              <BookOpen size={18} />
            </span>
            <Link
              className="record-main"
              to={`/practice/${encodeURIComponent(record.skill_id)}`}
              state={{ fromHistory: true, record }}
            >
              <h3>{record.title || record.skill_name}</h3>
              <p>
                {record.context || record.category} ·{" "}
                {parseTimestamp(record.end_time).toLocaleString("zh-CN", {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}{" "}
                ·{" "}
                {Number.isFinite(duration)
                  ? durationLabel(Math.floor(duration))
                  : "时长未记录"}
              </p>
            </Link>
            <span className="record-mode">
              {{
                guided: "引导练习",
                independent: "独立练习",
                transfer: "迁移练习",
              }[record.mode || ""] || "任务练习"}
            </span>
            <div className="record-score">
              {record.score}
              <small> /100</small>
            </div>
            <Link
              className="record-open"
              to={`/practice/${encodeURIComponent(record.skill_id)}`}
              state={{ fromHistory: true, record }}
              aria-label={`查看${record.title || record.skill_name}的反馈`}
            >
              <ArrowUpRight size={18} />
            </Link>
            {onDelete && record.record_id && (
              <button
                className="record-delete"
                aria-label={`删除${record.title || record.skill_name}的记录`}
                disabled={deletingId === record.record_id}
                onClick={() => onDelete(record)}
              >
                <Trash2 size={15} />
              </button>
            )}
          </article>
        );
      })}
    </div>
  );
}
