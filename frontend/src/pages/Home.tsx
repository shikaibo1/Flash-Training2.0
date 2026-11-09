import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, FileCheck2, Layers3, Network, Route } from 'lucide-react';
import { careerApi, systemApi } from '../lib/api';
import type { Recommendation } from '../types';

const learningModes = [
  { title: '引导练习', label: '先理解', description: '借助提示与示例，理解行动的方法和边界。', icon: BookOpen },
  { title: '独立练习', label: '再尝试', description: '独立完成一份交付物，留下自己的作答证据。', icon: FileCheck2 },
  { title: '迁移练习', label: '换个情境', description: '在变化的任务条件中，检验同一行动能力。', icon: Route },
];

export default function Home() {
  const [recommendations, setRecommendations] = useState<Recommendation[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    careerApi.recommendations()
      .then(result => { if (active) setRecommendations(result.recommendations); })
      .catch(error => { if (active) setError(error.message); });
    systemApi.health()
      .then(result => {
        if (active && !result.ai_configured) {
          setNotice('AI 尚未配置。可浏览图谱、固定案例与证据；生成普通练习和评估作答需要配置服务。');
        }
      })
      .catch(error => { if (active) setNotice(error.message); });
    return () => { active = false; };
  }, [revision]);

  return <div className="page-stack">
    <div className="page-topline"><span>学习工作台</span><span className="eyebrow">YOUR LEARNING SPACE</span></div>
    <section className="home-hero">
      <div className="home-hero-copy">
        <span className="section-kicker"><span className="status-dot" /> 从课堂，走向真实任务</span>
        <h1>知识学过了，<br />现在，<em>试着用出来。</em></h1>
        <p>从一份小交付开始，把课程知识变成具体行动。理解方法、独立尝试，再看看换个情境，你能做到哪一步。</p>
        <div className="flex flex-wrap gap-3">
          <Link to="/bridge" className="action-primary">开始迁移训练 <ArrowRight size={18} aria-hidden="true" /></Link>
          <Link to="/graph" className="action-secondary"><Network size={17} aria-hidden="true" /> 探索能力图谱</Link>
        </div>
        <p className="hero-footnote">短时任务 · 文字交付 · 依据原始回答反馈</p>
      </div>
      <div className="learning-illustration" aria-label="学习路径示意：从课程知识到行动原子，再到工作交付">
        <div className="illustration-heading"><span>把知识连成行动</span><span className="eyebrow">LEARNING PATH</span></div>
        <div className="path-card path-card-knowledge"><span className="path-icon"><BookOpen size={21} aria-hidden="true" /></span><div><small>01 / 课程知识</small><strong>理解指标与口径</strong><p>从一个熟悉的概念出发</p></div><span className="path-card-dot" /></div>
        <div className="path-connector" aria-hidden="true"><span /><ArrowRight size={15} /></div>
        <div className="path-card path-card-action"><span className="path-icon"><Layers3 size={21} aria-hidden="true" /></span><div><small>02 / 行动原子</small><strong>提取、核算、比较</strong><p>让“知道”变成可观察的动作</p></div><span className="path-card-dot" /></div>
        <div className="path-connector" aria-hidden="true"><span /><ArrowRight size={15} /></div>
        <div className="path-card path-card-delivery"><span className="path-icon"><FileCheck2 size={21} aria-hidden="true" /></span><div><small>03 / 工作交付</small><strong>完成一份分析简报</strong><p>用实际回答留下能力证据</p></div><span className="path-card-dot" /></div>
        <p className="illustration-caption">路径示意 · 核对活动转化简报</p>
      </div>
    </section>
    {notice && <p role="status" className="notice-panel">{notice}</p>}
    <Link to="/bridge" className="featured-training">
      <span className="feature-icon"><Route size={24} aria-hidden="true" /></span>
      <div><span className="eyebrow">专题训练</span><h2>同一个任务，换一种条件。</h2><p>基线 → 表征变式 → 条件边界 → 综合交付</p></div>
      <span className="feature-link">探索训练路径 <ArrowUpRight size={20} aria-hidden="true" /></span>
    </Link>
    <section className="space-y-5">
      <div className="section-heading"><div><span className="eyebrow">NEXT STEP</span><h2>下一步，练什么？</h2><p>根据已有证据与任务关系，为你提供练习方向。</p></div><Link to="/skills" className="text-link">全部任务 <ArrowRight size={16} aria-hidden="true" /></Link></div>
      {error && <div role="alert" className="notice-panel">{error} <button className="text-link" onClick={() => { setError(''); setRevision(value => value + 1); }}>重试</button></div>}
      {!recommendations && !error && <p role="status" className="empty-panel">正在为你整理练习建议…</p>}
      {recommendations?.length === 0 && <div className="empty-panel">暂无建议，可从<Link className="text-link" to="/skills">任务库</Link>自主选择。</div>}
      <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-4">{recommendations?.map(item =>
        <article key={`${item.skill_id}-${item.context}`} className="task-card">
          <div className="flex items-center justify-between gap-3"><span className="context-badge">{item.context}</span><Layers3 size={19} className="text-muted-foreground" aria-hidden="true" /></div>
          <h3>{item.title}</h3><p className="task-reason">{item.reason}</p>
          <div className="mode-links">{(['guided', 'independent', 'transfer'] as const).map((mode, index) => <Link key={mode}
            to={`/practice/${encodeURIComponent(item.skill_id)}?mode=${mode}&atoms=${encodeURIComponent(item.target_atomic_ids.join(','))}`}>
            {['引导练习', '独立练习', '迁移练习'][index]}<ArrowUpRight size={13} aria-hidden="true" />
          </Link>)}</div>
        </article>)}
      </div>
    </section>
    <section className="learning-modes" aria-label="三种练习方式">{learningModes.map(({ title, label, description, icon: Icon }) =>
      <article key={title}><Icon size={22} strokeWidth={1.6} aria-hidden="true" /><div><span className="eyebrow">{label}</span><h2>{title}</h2><p>{description}</p></div></article>)}
    </section>
  </div>;
}
