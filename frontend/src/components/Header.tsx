import { useState } from "react";
import type { FormEvent } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowUpRight,
  BookOpen,
  Route,
  ChevronRight,
  CircleUserRound,
  ClipboardList,
  GitBranch,
  LayoutDashboard,
  Search,
  Shapes,
  Sprout,
} from "lucide-react";

const navigation = [
  { to: "/", label: "学习概览", short: "概览", icon: LayoutDashboard },
  { to: "/projects", label: "学习目标", short: "目标", icon: Sprout },
  { to: "/bridge", label: "迁移训练", short: "迁移", icon: Route },
  { to: "/skills", label: "任务练习", short: "任务", icon: BookOpen },
  { to: "/graph", label: "能力图谱", short: "图谱", icon: GitBranch },
  { to: "/learning-curve", label: "能力证据", short: "证据", icon: Shapes },
  { to: "/history", label: "练习记录", short: "记录", icon: ClipboardList },
  { to: "/profile", label: "个人中心", short: "我的", icon: CircleUserRound },
];

export default function Header() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const current =
    navigation.find((item) => item.to === pathname)?.label ||
    (pathname.startsWith("/projects/")
      ? "学习目标"
      : pathname.startsWith("/practice")
        ? "练习工作台"
        : "学习空间");
  const date = new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    navigate(
      `/skills${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ""}`,
    );
    setSearch("");
  };
  return (
    <>
      <aside className="app-sidebar" aria-label="学习空间导航">
        <Link className="brand" to="/" aria-label="FlashTrain 学习概览">
          <span className="brand-mark">
            <Shapes size={24} strokeWidth={1.7} />
          </span>
          <span>
            <strong>
              FlashTrain<span className="brand-dot">.</span>
            </strong>
            <small>把知识练成能力</small>
          </span>
        </Link>
        <div className="sidebar-section-label">学习空间</div>
        <nav className="sidebar-nav">
          {navigation.slice(0, 6).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              <ChevronRight size={14} className="nav-chevron" />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-section-label review-label">学习回顾</div>
        <nav className="sidebar-nav">
          {navigation.slice(6).map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.7} />
              <span>{label}</span>
              <ChevronRight size={14} className="nav-chevron" />
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-note">
            <Sprout size={23} strokeWidth={1.5} />
            <p>
              每一次尝试，
              <br />
              都让理解更清晰。
            </p>
            <Link to="/learning-curve">
              查看我的学习证据
              <ArrowUpRight size={14} />
            </Link>
          </div>
          <Link to="/profile" className="sidebar-profile">
            <span className="avatar">学</span>
            <span>
              <strong>本地学习者</strong>
              <small>我的学习空间</small>
            </span>
            <ChevronRight size={15} />
          </Link>
        </div>
      </aside>
      <header className="workspace-header">
        <div className="header-breadcrumb">
          <span>我的学习空间</span>
          <ChevronRight size={14} />
          <strong>{current}</strong>
        </div>
        <Link className="mobile-brand" to="/">
          <Shapes size={24} />
          <strong>FlashTrain.</strong>
        </Link>
        <div className="header-actions">
          <span className="header-date">{date}</span>
          <form className="header-search" onSubmit={submitSearch}>
            <Search size={16} />
            <input
              aria-label="搜索任务或能力"
              placeholder="搜索任务或能力"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <kbd>↵</kbd>
          </form>
          <Link
            to="/profile"
            className="avatar header-avatar"
            aria-label="打开个人中心"
          >
            学
          </Link>
        </div>
      </header>
      <nav className="mobile-navigation" aria-label="移动端导航">
        {navigation
          .filter((item) =>
            ["/", "/projects", "/bridge", "/graph", "/learning-curve"].includes(
              item.to,
            ),
          )
          .map(({ to, short, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              <Icon size={20} strokeWidth={1.7} />
              <span>{short}</span>
            </NavLink>
          ))}
      </nav>
    </>
  );
}
