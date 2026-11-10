import type { ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  CircleHelp,
  MoveUpRight,
  Shuffle,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";

export function PageHeading({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  caption,
  icon: Icon,
  tone = "green",
}: {
  label: string;
  value: ReactNode;
  caption: string;
  icon: LucideIcon;
  tone?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className={`icon-tile ${tone}`}>
          <Icon size={18} strokeWidth={1.7} />
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <p>{caption}</p>
    </article>
  );
}

export function EmptyState({
  title,
  description,
  icon: Icon = BookOpen,
  action,
}: {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon size={25} strokeWidth={1.5} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function Notice({
  children,
  onRetry,
}: {
  children: ReactNode;
  onRetry?: () => void;
}) {
  return (
    <div className="notice" role={onRetry ? "alert" : "status"}>
      <CircleHelp size={18} />
      <div>{children}</div>
      {onRetry && (
        <button className="text-link shrink-0" onClick={onRetry}>
          重新加载
        </button>
      )}
    </div>
  );
}

export function LoadingState({
  label = "正在读取学习内容…",
}: {
  label?: string;
}) {
  return (
    <div className="loading-state" role="status">
      <span className="loading-dot" />
      {label}
    </div>
  );
}

export function ModeSelector({
  value,
  onChange,
  compact = false,
}: {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
}) {
  const options = [
    {
      id: "guided",
      title: "引导练习",
      description: "借助提示，建立思路",
      icon: Sparkles,
    },
    {
      id: "independent",
      title: "独立练习",
      description: "收起提示，检验理解",
      icon: Check,
    },
    {
      id: "transfer",
      title: "迁移练习",
      description: "换个案例，试着运用",
      icon: Shuffle,
    },
  ];
  return (
    <div
      className={`mode-selector ${compact ? "compact" : ""}`}
      role="group"
      aria-label="选择练习方式"
    >
      {options.map(({ id, title, description, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={value === id ? "selected" : ""}
        >
          <Icon size={16} />
          <span>
            <strong>{title}</strong>
            {!compact && <small>{description}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

export function TextLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="text-link" to={to}>
      {children}
      <ArrowRight size={15} />
    </Link>
  );
}

export function ExploreLink({
  to,
  children,
}: {
  to: string;
  children: ReactNode;
}) {
  return (
    <Link className="button-secondary" to={to}>
      {children}
      <MoveUpRight size={15} />
    </Link>
  );
}
