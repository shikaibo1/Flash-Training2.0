import { Link, useLocation } from 'react-router-dom';
import { ArrowUpRight, BookOpen, ChartNoAxesCombined, Compass, History, Network, Route, User, Zap } from 'lucide-react';

const navigation = [
  { path: '/', label: '学习工作台', icon: Compass },
  { path: '/bridge', label: '迁移训练', icon: Route },
  { path: '/skills', label: '职业任务库', icon: BookOpen },
  { path: '/graph', label: '能力图谱', icon: Network },
  { path: '/learning-curve', label: '能力证据', icon: ChartNoAxesCombined },
  { path: '/history', label: '练习记录', icon: History },
];

export default function Header() {
  const { pathname } = useLocation();

  return <header className="workspace-sidebar">
    <div className="sidebar-brand-row">
      <Link to="/" className="brand-lockup" aria-label="闪练 FlashTrain 首页">
        <span className="brand-mark"><Zap size={24} fill="currentColor" aria-hidden="true" /></span>
        <span><strong>闪练<span className="brand-english">FlashTrain</span></strong><small>从知识，到行动。</small></span>
      </Link>
      <Link to="/profile" className="mobile-profile" aria-label="我的资料"><User size={19} /></Link>
    </div>
    <p className="sidebar-label">学习空间</p>
    <nav aria-label="主导航" className="workspace-nav">
      {navigation.map(({ path, label, icon: Icon }) => <Link key={path} to={path}
        aria-current={pathname === path ? 'page' : undefined}
        className={`workspace-nav-link ${pathname === path ? 'is-active' : ''}`}>
        <Icon size={19} strokeWidth={1.8} aria-hidden="true" /><span>{label}</span>
        {pathname === path && <span className="nav-active-dot" aria-hidden="true" />}
      </Link>)}
    </nav>
    <div className="sidebar-bottom">
      <div className="sidebar-note">
        <span className="eyebrow">LEARN BY DOING</span>
        <p>让学过的知识，<br />有一次被用上的机会。</p>
        <Link to="/bridge">从一个小任务开始 <ArrowUpRight size={16} aria-hidden="true" /></Link>
      </div>
      <Link to="/profile" className={`sidebar-profile ${pathname === '/profile' ? 'is-active' : ''}`} aria-current={pathname === '/profile' ? 'page' : undefined}>
        <span className="profile-avatar"><User size={19} aria-hidden="true" /></span>
        <span>我的学习档案<small>记录每一次行动</small></span>
        <ArrowUpRight size={16} aria-hidden="true" />
      </Link>
    </div>
  </header>;
}
