import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Layers3 } from 'lucide-react';
import { careerApi } from '../lib/api';
import type { GraphData } from '../types';
export default function SkillsLibrary() {
  const [graph, setGraph] = useState<GraphData | null>(null);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    careerApi.graph()
      .then(value => { if (active) setGraph(value); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [revision]);

  const tasks = graph?.tasks.filter(task => {
    const matchesRole = !role || task.role_id === role;
    const searchableText = `${task.name} ${task.display_name} ${task.description} ${task.context}`;
    return matchesRole && searchableText.toLowerCase().includes(query.toLowerCase());
  });

  return <div className="page-stack">
    <div className="page-topline"><span>学习空间 / 职业任务库</span><span className="eyebrow">PRACTICE LIBRARY</span></div>
    <div className="page-heading"><span className="section-kicker"><BookOpen size={16} aria-hidden="true" /> 从一份具体交付开始</span><h1>选择任务，练出行动。</h1>
      <p>每个任务都有明确的交付物与原子能力。选一个感兴趣的方向，把课堂上学到的知识用起来。</p></div>
    <div className="filter-bar">
      <input aria-label="搜索任务" placeholder="搜索任务、情境…" value={query} onChange={e => setQuery(e.target.value)}/>
        <select aria-label="职业筛选" value={role} onChange={e => setRole(e.target.value)}>
          <option value="">全部职业</option>{graph?.roles.map(item =>
          <option key={item.role_id} value={item.role_id}>{item.name}</option>)}
        </select>
        <Link className="text-link px-2" to="/graph">查看能力关系图 <ArrowRight size={15} aria-hidden="true" /></Link>
      </div>
      {error &&
      <div role="alert">{error}
        <button className="text-primary" onClick={() => { setError(''); setRevision(v => v + 1); }}>重试</button>
      </div>}{!graph && !error &&
      <p role="status">加载任务定义…</p>}{tasks?.length === 0 &&
      <p>没有匹配任务，试试其他关键词或职业。</p>}
      <div className="grid lg:grid-cols-2 gap-5">{tasks?.map(task =>
        <article key={task.skill_id} className="task-card">
          <div className="flex items-center justify-between gap-3"><p className="context-badge">{graph?.roles.find(item => item.role_id === task.role_id)?.name} · {task.context}</p><Layers3 size={18} className="text-muted-foreground shrink-0" aria-hidden="true" /></div>
          <h2>{task.display_name || task.name}</h2>
          <p className="text-sm leading-relaxed text-muted-foreground">{task.task_brief || task.description}</p>
          <p className="rounded-lg bg-background p-3 text-xs leading-relaxed"><span className="font-semibold">交付物 / </span>{task.deliverable}</p>
          <div className="flex flex-wrap gap-2">{task.atomic_skills.map(id =>
            <Link key={id} className="text-xs rounded-md border px-2.5 py-1 text-muted-foreground hover:text-primary hover:border-primary" to={`/graph?node=${encodeURIComponent(`atom:${id}`)}`}>{graph?.atoms.find(atom => atom.atomic_skill_id === id)?.name || id}</Link>)}
          </div>
          <div className="mode-links">{(['guided','independent','transfer'] as const).map((mode, index) =>
            <Link key={mode} to={`/practice/${encodeURIComponent(task.skill_id)}?mode=${mode}`}>{['引导练习','独立练习','迁移练习'][index]} <ArrowRight size={13} aria-hidden="true" /></Link>)}
          </div>
        </article>)}
      </div>
      <div className="section-heading"><div><span className="eyebrow">BUILDING BLOCKS</span><h2>原子能力定义</h2><p>理解一个动作的输入、输出与适用边界。</p></div></div>
      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">{graph?.atoms.filter(atom => `${atom.name} ${atom.description}`.toLowerCase().includes(query.toLowerCase())).map(atom =>
        <article key={atom.atomic_skill_id} className="surface-panel p-5 space-y-3 text-xs leading-relaxed">
          <Link className="font-semibold text-primary" to={`/graph?node=${encodeURIComponent(`atom:${atom.atomic_skill_id}`)}`}>{atom.name}</Link>
          <p>{atom.action}</p>
          <p className="text-sm text-muted-foreground">输入：{atom.input_spec}</p>
          <p className="text-sm text-muted-foreground">输出：{atom.output_spec}</p>
          <p className="text-sm">边界：{atom.boundary}</p>
        </article>)}
      </div>
    </div>;
    }
