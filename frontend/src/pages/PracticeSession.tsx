import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronLeft, RefreshCw } from 'lucide-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import FeedbackPanel from '../components/FeedbackPanel';
import BridgeFeedback from '../components/BridgeFeedback';
import { practiceV1Api } from '../lib/api';
import type { SessionData } from '../lib/api';
import { scoreDimensions } from '../lib/feedback';
import type { ScoreDimension } from '../lib/feedback';
import { sessionCache } from '../lib/sessionCache';
import type { PracticeContent, PracticeRecord, EvidenceItem, AgentTrace } from '../types';

const userId = 'default_user';
type Feedback = { score: number; strengths: string[]; improvements: string[]; aiComment: string; dimensions: ScoreDimension[] };
type Session = SessionData;
// Shares an in-flight request across React effect remounts; no duplicate model requests.
const pendingSessions = new Map<string, Promise<Session>>();

function practiceCacheKey(skillId: string, mode: string, targetKey: string, bridgeCaseId: string, sourceSessionId: string) {
  const base = `flash-session:${userId}:${skillId}:${mode}:${targetKey}`;
  return bridgeCaseId || sourceSessionId ? `${base}:bridge:${encodeURIComponent(bridgeCaseId)}:source:${encodeURIComponent(sourceSessionId)}` : base;
}

function cacheKeyForSession(session: Session, mode: string, targetKey: string, bridgeCaseId: string, sourceSessionId: string) {
  const caseId = session.bridge_case_id || bridgeCaseId;
  const atoms = caseId
    ? (session.content.target_atomic_ids || session.atom_snapshot?.map(atom => atom.atomic_skill_id) || []).slice().sort().join(',')
    : targetKey;
  return practiceCacheKey(session.skill_id, session.mode || mode, atoms, caseId, session.source_session_id || sourceSessionId);
}

function forgetCachedSession(session: Session, mode: string, targetKey: string, bridgeCaseId: string, sourceSessionId: string) {
  const keys = [practiceCacheKey(session.skill_id, mode, targetKey, bridgeCaseId, sourceSessionId),
    cacheKeyForSession(session, mode, targetKey, bridgeCaseId, sourceSessionId)];
  for (const key of keys) if (sessionCache.read(key) === session.session_id) sessionCache.remove(key);
}

async function obtainSession(skillId: string, mode: string, targetIds: string[], bridgeCaseId: string, sourceSessionId: string): Promise<Session> {
  const key = practiceCacheKey(skillId, mode, targetIds.join(','), bridgeCaseId, sourceSessionId);
  const pending = pendingSessions.get(key);
  if (pending) return pending;
  const work = (async () => {
    const saved = sessionCache.read(key);
    if (saved) {
      try {
        const result = await practiceV1Api.getSession(userId, saved);
        if (result.data.status === 'active' || result.data.evaluation_result) return result.data;
      } catch (error) {
        // Only an absent session is discarded. Network/configuration errors stay visible.
        if (!(error instanceof Error) || !('status' in error) || error.status !== 404) throw error;
      }
      sessionCache.remove(key);
    }
    const result = await practiceV1Api.startPractice(userId, skillId, { mode,
      ...(targetIds.length ? { target_atomic_ids: targetIds } : {}),
      ...(bridgeCaseId ? { bridge_case_id: bridgeCaseId } : {}),
      ...(sourceSessionId ? { source_session_id: sourceSessionId } : {}),
    });
    sessionCache.write(key, result.data.session_id);
    return result.data as Session;
  })();
  pendingSessions.set(key, work);
  try { return await work; }
  finally { if (pendingSessions.get(key) === work) pendingSessions.delete(key); }
}

const PracticeSession = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const search = new URLSearchParams(location.search);
  const requestedMode = search.get('mode') || 'guided';
  const mode = ['guided', 'independent', 'transfer'].includes(requestedMode) ? requestedMode : 'guided';
  const targetKey = Array.from(new Set((search.get('atoms') || '').split(',').filter(Boolean))).sort().join(',');
  const bridgeCaseId = search.get('bridge_case_id') || '';
  const sourceSessionId = search.get('source_session_id') || '';
  const requestedSessionId = search.get('session_id') || '';
  const [assisted, setAssisted] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [evidence, setEvidence] = useState<EvidenceItem[]>([]);
  const [trace, setTrace] = useState<AgentTrace[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [content, setContent] = useState<PracticeContent | null>(null);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [draftNotice, setDraftNotice] = useState('');
  const [showExample, setShowExample] = useState(false);
  const [revision, setRevision] = useState(0);
  const mounted = useRef(false);
  const generation = useRef(0);
  const submitLock = useRef<string | null>(null);
  const historyRecord = (location.state as { fromHistory?: boolean; record?: PracticeRecord } | null)?.fromHistory
    ? (location.state as { record: PracticeRecord }).record : null;

  const displayMode = session?.mode || historyRecord?.mode || mode;

  useEffect(() => {
    mounted.current = true;
    generation.current += 1;
    let active = true;
    setLoading(true);
    setSession(null);
    setContent(null);
    setSubmitting(false);
    setError('');
    setDraftNotice('');
    setFeedback(null);
    setAnswer('');
    setShowExample(false);
    setShowHint(false); setAssisted(false); setEvidence([]); setTrace([]);
    const load = async () => {
      if (historyRecord) {
        setContent({ title: historyRecord.title || historyRecord.skill_name,
          description: historyRecord.description || '', category: historyRecord.category,
          difficulty: historyRecord.difficulty, hint: historyRecord.hint,
          example_answer: historyRecord.example_answer, materials: historyRecord.materials });
        setEvidence(historyRecord.evidence || []); setTrace(historyRecord.agent_trace || []);
        setAnswer(historyRecord.transcript || '');
        setAssisted(Boolean(historyRecord.assistance_used));
        setFeedback({ score: historyRecord.score, strengths: historyRecord.strengths || [],
          improvements: historyRecord.improvements || [], aiComment: historyRecord.ai_comment || '',
          dimensions: scoreDimensions(historyRecord.atomic_skill_scores, historyRecord.atomic_skill_names) });
        if (historyRecord.session_id) {
          try {
            const saved = (await practiceV1Api.getSession(userId, historyRecord.session_id)).data;
            if (!active) return;
            setSession(saved); setContent(saved.content);
            setEvidence(saved.evaluation_result?.evidence || []);
            setTrace([...(saved.agent_trace || []), ...(saved.evaluation_result?.agent_trace || [])]);
          } catch (err) { if (active) setError(err instanceof Error ? `记录正文已保留，但会话详情读取失败：${err.message}` : '会话详情读取失败'); }
        }
        if (active) setLoading(false);
        return;
      }
      try {
        let value: Session;
        if (requestedSessionId) {
          value = (await practiceV1Api.getSession(userId, requestedSessionId)).data;
        } else {
          let skillId = id;
          if (!id || id === 'random') {
            const skills = (await practiceV1Api.getAvailableSkills()).skills;
            skillId = skills[Math.floor(Math.random() * skills.length)]?.skill_id;
          }
          if (!skillId) throw new Error('暂无可练习的职业任务。');
          if ((!id || id === 'random') && active) { navigate(`/practice/${encodeURIComponent(skillId)}${location.search}`, { replace: true }); return; }
          if (!active) return;
          value = await obtainSession(skillId, mode, targetKey ? targetKey.split(',') : [], bridgeCaseId, sourceSessionId);
          if (active && bridgeCaseId) {
            // A concrete session URL restores this exact case after completion/reload.
            const sessionSearch = new URLSearchParams(location.search);
            sessionSearch.set('session_id', value.session_id);
            navigate(`/practice/${encodeURIComponent(value.skill_id)}?${sessionSearch}`, { replace: true });
            return;
          }
        }
        if (active) {
          setSession(value);
          setAssisted(sessionCache.read(`flash-assisted:${value.session_id}`) === 'true');
          setTrace([...(value.agent_trace || value.content.agent_trace || []), ...(value.evaluation_result?.agent_trace || [])]);
          setEvidence(value.evaluation_result?.evidence || []);
          setContent(value.content);
          if (value.status === 'completed' && value.evaluation_result) {
            const result = value.evaluation_result;
            setAnswer(value.answer || '');
            setFeedback({ score: Math.round(result.score * 10), strengths: result.strengths,
              improvements: result.improvements, aiComment: result.aiComment,
              dimensions: scoreDimensions(result.atomic_skill_scores, value.atomic_skill_names) });
          } else {
            setAnswer(sessionCache.read(`flash-draft:${value.session_id}`) || '');
          }
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : '加载失败，请重试。');
      } finally { if (active) setLoading(false); }
    };
    void load();
    return () => { active = false; mounted.current = false; };
  }, [id, historyRecord, revision, mode, targetKey, bridgeCaseId, sourceSessionId, requestedSessionId, navigate, location.search]);

  const submit = async () => {
    if (!session || !answer.trim() || submitLock.current === session.session_id) return;
    const requestGeneration = generation.current;
    const requestSessionId = session.session_id;
    submitLock.current = requestSessionId;
    setSubmitting(true);
    setError('');
    try {
      const result = await practiceV1Api.submitAnswer(userId, session.session_id, answer, assisted);
      const evaluation = result.data.evaluation_result;
      forgetCachedSession(session, mode, targetKey, bridgeCaseId, sourceSessionId);
      sessionCache.remove(`flash-draft:${session.session_id}`);
      window.dispatchEvent(new CustomEvent('practice:record-saved', { detail: { recordId: result.data.record_id } }));
      window.dispatchEvent(new CustomEvent('practice:completed'));
      if (mounted.current && generation.current === requestGeneration) {
        setEvidence(evaluation.evidence || []); setTrace([...(session.agent_trace || session.content.agent_trace || []), ...(evaluation.agent_trace || [])]);
        setFeedback({ score: Math.round(evaluation.score * 10),
        strengths: evaluation.strengths, improvements: evaluation.improvements,
        aiComment: evaluation.aiComment,
        dimensions: scoreDimensions(evaluation.atomic_skill_scores, session.atomic_skill_names) });
        // Completed sessions can expose reference material withheld during independent work.
        if (displayMode !== 'guided') {
          try {
            const completed = (await practiceV1Api.getSession(userId, requestSessionId)).data;
            if (mounted.current && generation.current === requestGeneration) setContent(completed.content);
          } catch {
            if (mounted.current && generation.current === requestGeneration) setDraftNotice('评估已保存；参考材料暂时无法读取，可在练习记录中重新打开。');
          }
        }
      }
    } catch (err) {
      // Keep answer and session for retry; a failed request never becomes a fake grade.
      if (mounted.current && generation.current === requestGeneration) setError(err instanceof Error ? err.message : '评估失败，请重试。');
    } finally {
      if (submitLock.current === requestSessionId) submitLock.current = null;
      if (mounted.current && generation.current === requestGeneration) setSubmitting(false);
    }
  };

  const revealAssistance = () => {
    setAssisted(true);
    if (session && !sessionCache.write(`flash-assisted:${session.session_id}`, 'true')) setDraftNotice('辅助使用标记无法保存；本次提交仍会记录，刷新前请先完成提交。');
  };

  const startAgain = () => {
    if (session) forgetCachedSession(session, mode, targetKey, bridgeCaseId, sourceSessionId);
    if (requestedSessionId) {
      const nextSearch = new URLSearchParams(location.search);
      nextSearch.delete('session_id');
      if (session) {
        nextSearch.set('mode', session.mode || mode);
        nextSearch.set('atoms', (session.content.target_atomic_ids || session.atom_snapshot?.map(atom => atom.atomic_skill_id) || []).join(','));
        if (session.bridge_case_id) nextSearch.set('bridge_case_id', session.bridge_case_id);
        if (session.source_session_id) nextSearch.set('source_session_id', session.source_session_id);
      }
      navigate(`/practice/${encodeURIComponent(session?.skill_id || id || 'random')}?${nextSearch}`, { replace: true });
    } else setRevision(value => value + 1);
  };

  const isBridge = Boolean(session?.bridge_case_id || bridgeCaseId || historyRecord?.bridge_case_id);
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Link to={isBridge ? '/bridge' : '/skills'} className="text-link"><ChevronLeft size={17} />{isBridge ? '返回迁移训练路径' : '返回任务库'}</Link>
      <div className="practice-paper space-y-6">
        {loading ? <div className="py-20 flex flex-col items-center gap-4"><Brain className="animate-pulse text-primary" size={40} /><p>正在准备练习...</p></div> : <>
          {error && <div role="alert" className="p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg space-y-3">
            <p>{error}</p>
            {!content && <button className="underline" onClick={() => setRevision(v => v + 1)}>重试</button>}
            {content && !feedback && !submitting && <div className="space-y-2"><p className="text-sm">可先复制当前回答；放弃后旧草稿仍按原会话保留。{isBridge ? '重新作答会创建同一固定案例的新会话。' : '重新出题会调用模型并产生费用。'}</p><button className="underline" onClick={startAgain}>放弃本次，重新开始</button><Link className="ml-4 underline" to={isBridge ? '/bridge' : '/skills'}>选择其他练习</Link></div>}
          </div>}
          {content && <>
            <span className="context-badge">{content.category} · {content.difficulty} · {{ guided: '引导练习', independent: '独立练习', transfer: '迁移练习' }[displayMode]}</span>
            <h1 className="text-2xl sm:text-3xl font-bold leading-snug tracking-tight">{content.title}</h1>
            {/* Model text is rendered as text, never injected as executable HTML. */}
            <p className="whitespace-pre-wrap leading-loose text-sm text-muted-foreground">{content.description}</p>
            {content.materials && <section className="practice-materials whitespace-pre-wrap"><h2 className="font-semibold mb-3 text-foreground">任务材料</h2>{content.materials}</section>}
            {session?.atom_snapshot && <details className="border rounded-xl p-4 text-sm leading-relaxed"><summary className="cursor-pointer font-medium">本次目标与评分依据</summary>{session.atom_snapshot.filter(atom => !content.target_atomic_ids?.length || content.target_atomic_ids.includes(atom.atomic_skill_id)).map(atom => <div key={atom.atomic_skill_id} className="mt-4 border-t pt-3"><h3 className="font-semibold">{atom.name}</h3><p>{atom.action}</p><ul className="list-disc pl-5 text-muted-foreground">{atom.rubric.map(item => <li key={item}>{item}</li>)}</ul></div>)}</details>}
            {content.hint && (displayMode === 'guided' || feedback) && <div><button className="text-primary" disabled={submitting} onClick={() => { if (!feedback) revealAssistance(); setShowHint(v => !v); }}>{showHint ? '收起提示' : feedback ? '查看提示' : '查看提示（记录辅助使用）'}</button>{showHint && <p className="p-4 bg-yellow-50 rounded-lg whitespace-pre-wrap">{content.hint}</p>}</div>}
            {content.example_answer && (displayMode === 'guided' || feedback) && <div>
              <button className="text-primary" disabled={submitting} onClick={() => { if (!feedback) revealAssistance(); setShowExample(v => !v); }}>{showExample ? '收起参考答案' : feedback ? '查看参考答案' : '查看参考答案（记录辅助使用）'}</button>
              {showExample && <p className="mt-3 p-4 bg-blue-50 rounded-lg whitespace-pre-wrap">{content.example_answer}</p>}
            </div>}
            {feedback ? <>
              <div className="p-4 bg-secondary rounded-lg whitespace-pre-wrap"><h2 className="font-semibold mb-2">你的回答</h2>{answer}</div>
              <FeedbackPanel {...feedback} skillCategory={content.category} />
              {evidence.length > 0 && <section className="space-y-4"><h2 className="text-xl font-semibold">原子能力证据</h2>{evidence.map(item => <article key={item.atomic_skill_id} className="p-4 border rounded-lg space-y-2"><h3 className="font-semibold">{session?.atom_snapshot?.find(atom => atom.atomic_skill_id === item.atomic_skill_id)?.name || item.atomic_skill_id} · {item.status === 'not_observable' ? '本次不可观察' : `本次评分 ${item.score ?? '未评分'}`}</h3>{item.quote && <blockquote className="border-l-4 pl-3 whitespace-pre-wrap">{item.quote}</blockquote>}<p>{item.reason}</p><p>下一步：{item.next_action}</p></article>)}<Link className="text-primary" to="/learning-curve">查看情境证据档案 →</Link></section>}
              {draftNotice && <p role="status" className="text-sm text-amber-700">{draftNotice}</p>}
              {historyRecord ? <Link to="/skills" className="text-primary">开始新练习</Link> :
                <button onClick={startAgain} className="inline-flex items-center gap-2 text-primary"><RefreshCw size={18} />{isBridge ? '重新作答此案例' : '再练一道'}</button>}
            </> : <div className="space-y-4">
              {displayMode !== 'guided' && <label className="flex items-center gap-2"><input type="checkbox" checked={assisted} disabled={submitting} onChange={event => { const value = event.target.checked; setAssisted(value); if (session) sessionCache.write(`flash-assisted:${session.session_id}`, String(value)); }}/>本次使用了外部提示、参考答案或他人帮助</label>}
              <label htmlFor="response-text" className="block font-medium">请输入你的回答</label>
              <textarea id="response-text" value={answer} onChange={e => {
                setAnswer(e.target.value);
                if (session && !sessionCache.write(`flash-draft:${session.session_id}`, e.target.value)) {
                  setDraftNotice('草稿暂时无法保存，刷新前请复制你的回答。');
                }
              }} maxLength={50000}
                disabled={submitting} className="w-full min-h-64 p-5 border rounded-xl bg-background text-sm leading-loose resize-y focus:border-primary transition-colors"
                placeholder="在这里输入你的回答内容..." />
              <div className="flex items-center justify-between gap-4"><span className="text-sm text-muted-foreground">{answer.length} 字符</span>
                <button onClick={submit} disabled={!answer.trim() || submitting || !session}
                  className="action-primary">{submitting ? '正在评估...' : '提交并获取评估'}</button>
              </div>
              <p className="text-xs text-muted-foreground">{displayMode === 'guided' ? '引导模式结果仅作为辅助完成证据；查看提示与示例仍需主动点击。' : assisted ? '本次已记录辅助使用。' : '本次尚未声明辅助使用。'} 评估成功后保存原始回答和证据；失败可重试。</p>
              {draftNotice && <p role="status" className="text-sm text-amber-700">{draftNotice}</p>}
            </div>}
            {isBridge && session && <BridgeFeedback key={session.session_id} sessionId={session.session_id} completed={Boolean(feedback)} assistanceUsed={assisted || displayMode === 'guided'} atomicNames={session.atomic_skill_names} />}
            {trace.length > 0 && <details className="border-t pt-4"><summary className="cursor-pointer font-medium">实际 Agent 执行记录</summary>{trace.map((item, index) => <div key={index} className="mt-3 text-sm"><p className="font-medium">{item.agent} · {item.method}</p><p className="text-muted-foreground">{item.summary}</p></div>)}</details>}
          </>}
        </>}
      </div>
    </div>
  );
};

export default PracticeSession;
