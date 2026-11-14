import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { careerApi } from '../lib/api';
import { statusLabels } from '../lib/evidence';
import { parseTimestamp } from '../lib/stats';
import type { EvidenceTimeline as TimelineData, EvidenceTimelineItem } from '../types/goalGraph';
import './goalGraph.css';

type Props = { atomicSkillId: string; context?: string; projectId?: string };
const stages = { practice: '单次练习', initial: '项目初答', probe: '诊断追问', verification: '新任务复测' };
const modes: Record<string, string> = { guided: '引导', independent: '独立', transfer: '迁移' };

function RecordDetails({ item }: { item: EvidenceTimelineItem }) {
  const date = parseTimestamp(item.created_at);
  const href = item.source === 'project' && item.project_id
    ? `/projects/${encodeURIComponent(item.project_id)}${item.round_id ? `#round-${encodeURIComponent(item.round_id)}` : ''}`
    : item.session_id && item.skill_id
      ? `/practice/${encodeURIComponent(item.skill_id)}?session_id=${encodeURIComponent(item.session_id)}` : null;
  return <>
    <div className="timeline-meta"><time dateTime={item.created_at}>{Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN') : '时间未记录'}</time><span>{item.context}</span></div>
    <h4>{item.title}</h4>
    <div className="timeline-badges"><span>{stages[item.stage]}</span>{item.mode && <span>{modes[item.mode] || item.mode}模式</span>}<span>{item.assistance_used || item.mode === 'guided' ? '有辅助' : item.stage === 'probe' ? '追问后作答' : '未声明辅助'}</span><span className={`evidence-state state-${item.status}`}>{statusLabels[item.status]}</span></div>
    {item.quote ? <blockquote>“{item.quote}”</blockquote> : <p className="goal-muted">此记录没有原文引用；请结合判断理由及原始任务核对。</p>}
    <p><strong>判断依据：</strong>{item.reason}</p>
    <p><strong>下一步：</strong>{item.next_action}</p>
    <p className="goal-muted">{item.score === null ? '定性判断 / 未换算分数' : `本次原子评分 ${item.score}/10`} · {item.definition_version === null ? '定义版本未记录' : `定义版本 v${item.definition_version}`}</p>
    {href && <Link className="goal-text-link" to={href}>查看原始作答 →</Link>}
  </>;
}

function TimelineResults({ atomicSkillId, context, projectId, onContexts }: Props & { onContexts: (contexts: string[]) => void }) {
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<(TimelineData & { loadedOffset: number }) | null>(null);
  const [failure, setFailure] = useState<{ offset: number; message: string } | null>(null);
  const [comparison, setComparison] = useState<EvidenceTimelineItem[]>([]);
  useEffect(() => {
    let active = true;
    careerApi.evidenceTimeline(atomicSkillId, { context, projectId, offset, limit: 20 }).then(page => {
      if (!active) return;
      setResult(previous => ({ ...page, loadedOffset: offset,
        items: offset === 0 ? page.items : Array.from(new Map([...(previous?.items || []), ...page.items].map(item => [item.id, item])).values()) }));
      setFailure(null);
      onContexts(page.contexts);
    }).catch(error => { if (active) setFailure({ offset, message: error.message }); });
    return () => { active = false; };
  }, [atomicSkillId, context, projectId, offset, revision, onContexts]);
  const pending = result?.loadedOffset !== offset && failure?.offset !== offset;
  const differentConditions = comparison.length === 2 && (
    comparison[0].context !== comparison[1].context || comparison[0].definition_version === null ||
    comparison[0].definition_version !== comparison[1].definition_version ||
    comparison[0].assistance_used !== comparison[1].assistance_used || comparison[0].mode !== comparison[1].mode ||
    comparison[0].stage !== comparison[1].stage
  );
  return <div>
    {comparison.length > 0 && <section className="timeline-compare" aria-label="证据并排查看">
      <div className="goal-section-title"><h4>已选择 {comparison.length}/2 条证据</h4><button type="button" onClick={() => setComparison([])}>清空选择</button></div>
      <p className="goal-muted">{differentConditions ? '两次记录的情境、定义版本或作答条件不同 / 不完整，不能直接作同条件比较。' : '对照具体依据与作答条件；不同材料下的表现不直接等于学习增益。'}不自动计算提升分数。</p>
      <div className="timeline-compare-grid">{comparison.map(item => <article key={item.id}><RecordDetails item={item} /></article>)}</div>
    </section>}
    {result && <p className="goal-muted">共 {result.total} 条证据，已展示 {result.items.length} 条 · 最新在前</p>}
    {result?.items.length === 0 && <p className="goal-empty">此范围尚无证据，可以先完成一次独立尝试。</p>}
    <ol className="evidence-timeline">{result?.items.map(item => {
      const chosen = comparison.some(selected => selected.id === item.id);
      return <li key={item.id}><label className="timeline-choose"><input type="checkbox" checked={chosen}
        disabled={!chosen && comparison.length >= 2} onChange={() => setComparison(current => chosen ? current.filter(selected => selected.id !== item.id) : [...current, item])} />加入对照</label><RecordDetails item={item} /></li>;
    })}</ol>
    {pending && <p role="status">正在读取证据…</p>}
    {failure && <div role="alert"><p>{failure.message}</p><button className="goal-button" type="button" onClick={() => { setFailure(null); setRevision(value => value + 1); }}>重试读取</button></div>}
    {result && !pending && !failure && result.offset + result.limit < result.total && <button className="goal-button" type="button" onClick={() => setOffset(result.offset + result.limit)}>加载更多证据</button>}
  </div>;
}

function TimelineView({ atomicSkillId, context: initialContext, projectId }: Props) {
  const [context, setContext] = useState(initialContext || '');
  const [onlyProject, setOnlyProject] = useState(false);
  const [contexts, setContexts] = useState<string[]>([]);
  const choices = Array.from(new Set([...(initialContext ? [initialContext] : []), ...contexts, ...(context ? [context] : [])]));
  return <section className="timeline-panel" aria-label="能力证据时间线">
    <div className="goal-section-title"><h3>能力证据时间线</h3></div>
    <div className="timeline-filters"><label>情境 <select aria-label="证据情境" value={context} onChange={event => setContext(event.target.value)}><option value="">全部情境</option>{choices.map(value => <option key={value}>{value}</option>)}</select></label>
      {projectId && <label><input type="checkbox" checked={onlyProject} onChange={event => setOnlyProject(event.target.checked)} />只看当前项目</label>}
    </div>
    <TimelineResults key={`${context}|${onlyProject ? projectId : ''}`} atomicSkillId={atomicSkillId} context={context || undefined} projectId={onlyProject ? projectId : undefined} onContexts={setContexts} />
  </section>;
}

export default function EvidenceTimeline(props: Props) {
  return <TimelineView key={`${props.atomicSkillId}|${props.context || ''}|${props.projectId || ''}`} {...props} />;
}
