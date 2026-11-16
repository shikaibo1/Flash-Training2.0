import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, CheckCheck, LockKeyhole, RefreshCw, Sparkles } from 'lucide-react';
import { useAchievements } from '../hooks/useAchievements';
import AchievementBadge from '../components/AchievementBadge';
import { LoadingState, Notice, PageHeading } from '../components/workspace/Primitives';
import type { Achievement, AchievementCategory } from '../types/achievements';
import './achievements.css';

const categories: ('全部' | AchievementCategory)[] = ['全部', '开始行动', '主动理解', '独立验证'];

function AwardCard({ item }: { item: Achievement }) {
  const stamp = item.award ? new Date(item.award.achieved_at) : null;
  return <article className={`achievement-card ${item.unlocked ? 'is-earned' : ''}`}>
    <div className="achievement-card-top"><span>{item.category}</span><span className={`achievement-state ${item.unlocked ? 'earned' : ''}`}>
      {item.unlocked ? <Check size={12} /> : <LockKeyhole size={11} />}{item.unlocked ? '已解锁' : '待解锁'}</span></div>
    <AchievementBadge icon={item.icon} unlocked={item.unlocked} />
    <h2>{item.title}</h2><p className="achievement-description">{item.description}</p>
    <div className="achievement-card-bottom">
      <div className="achievement-progress-label"><span>{item.unlocked ? '达成记录已保存' : '当前进度'}</span><strong>{item.progress} / {item.target}</strong></div>
      <progress value={item.progress} max={item.target} aria-label={`${item.title}进度`} />
      {item.award ? <details className="achievement-proof"><summary>查看达成依据 <span>{stamp && Number.isFinite(stamp.getTime()) ? stamp.toLocaleDateString('zh-CN') : '已记录'}</span></summary>
        <p>{item.award.source_label}</p><p className="achievement-rule-version">规则 v{item.award.rule_version} · 纪念达成时的表现</p>
        <Link to={item.award.source_path}>查看对应学习记录 <ArrowRight size={13} /></Link>
      </details> : <Link className="achievement-action" to={item.action_path}>{item.action_label}<ArrowRight size={14} /></Link>}
    </div>
  </article>;
}

export default function Achievements() {
  const query = useAchievements();
  const { data, seen } = query;
  const [category, setCategory] = useState<(typeof categories)[number]>('全部');
  const [state, setState] = useState('all');
  const items = data?.items.filter(item => (category === '全部' || item.category === category) &&
    (state === 'all' || (state === 'earned' ? item.unlocked : !item.unlocked))) || [];
  const next = data?.items.filter(item => !item.unlocked).sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  return <div className="page-stack page-stack-wide achievements-page">
    <PageHeading eyebrow="THE SMALL WINS" title="成长成就" description="记住每一次认真尝试，也看见下一步的可能。"
      action={<button className="achievement-refresh" type="button" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} className={query.isFetching ? 'is-spinning' : ''} />刷新进度</button>} />
    {query.isPending && <LoadingState label="正在核对你的学习足迹…" />}
    {query.isError && <Notice onRetry={() => void query.refetch()}>成就暂时无法读取：{query.error.message}。你的学习记录仍然保留。</Notice>}
    {data && <>
      <section className="achievement-hero">
        <div className="achievement-hero-copy"><span className="achievement-kicker"><Sparkles size={14} /> SMALL STEPS, REAL PROGRESS</span>
          <h2>每一次认真，<br />都有回响。</h2><p>成就来自真实的学习记录。<br />发现不足、主动求助，再独立试一次，也是一种前进。</p>
          <div className="achievement-collection"><strong>{data.unlocked_count}<span> / {data.total}</span></strong><div><span>成长印记已点亮</span><progress aria-label="成就收集进度" value={data.unlocked_count} max={data.total} /></div></div>
        </div>
        <div className="achievement-hero-art" aria-hidden="true"><span className="achievement-orbit orbit-a" /><span className="achievement-orbit orbit-b" /><span className="achievement-art-spark spark-a">✧</span><span className="achievement-art-spark spark-b">✦</span>
          <AchievementBadge icon="gem" unlocked large /><span className="achievement-art-caption">一步一步 · 自有收获</span></div>
      </section>
      <div className="achievement-facts"><div><strong>{data.completed_tasks}</strong><span>已完成任务评估</span></div><div><strong>{data.independent_tasks}</strong><span>未声明辅助的独立尝试</span></div><div><strong>{data.independent_atoms}</strong><span>有独立支持证据的原子</span></div></div>
      <div className="achievement-next"><div><span className="small-label">{next ? '下一个小目标' : '每一步都算数'}</span><h3>{next ? next.title : '已收集当前全部成就'}</h3><p>{next ? next.description : '继续学习，积累更多情境与时间下的独立表现。'}</p></div>
        <Link className="button-secondary" to={next?.action_path || '/projects'}>{next?.action_label || '继续学习'}<ArrowRight size={15} /></Link></div>
      <section className="achievement-collection-section" aria-label="成就收藏">
        <div className="achievement-section-heading"><div><h2>我的成就收藏</h2><p>从行动到理解，再用独立尝试留下证据。</p></div>
          {data.unread_ids.length > 0 && <button className="achievement-read-all" disabled={seen.isPending} onClick={() => seen.mutate(data.unread_ids)}><CheckCheck size={15} />{seen.isPending ? '正在标记…' : '全部标为已读'}</button>}</div>
        {seen.isError && <Notice onRetry={() => seen.mutate(data.unread_ids)}>暂时无法标记已读，请重试。</Notice>}
        <div className="achievement-filters"><div className="achievement-tabs" role="group" aria-label="成就分类">{categories.map(value => <button type="button" key={value} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}<span>{value === '全部' ? data.total : data.items.filter(item => item.category === value).length}</span></button>)}</div>
          <select aria-label="成就解锁状态" value={state} onChange={event => setState(event.target.value)}><option value="all">全部状态</option><option value="earned">已解锁</option><option value="locked">待解锁</option></select></div>
        <div className="achievement-grid">{items.map(item => <AwardCard key={item.id} item={item} />)}</div>
        {!items.length && <div className="achievement-empty">{state === 'earned' ? '这个分类还没有解锁的成就，下一次认真尝试就可能是起点。' : '当前筛选下没有成就，试试其他分类。'}</div>}
      </section>
      <p className="achievement-footnote">成就纪念具体行为或某次可观察表现，不等同于长期掌握、行业认证或学习增益。独立性依据系统记录与辅助声明；已解锁印记保留，当前能力请结合图谱中的最新证据查看。</p>
    </>}
  </div>;
}
