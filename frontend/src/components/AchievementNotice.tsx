import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';
import { useAccount } from '../hooks/useAccount';
import { useAchievements } from '../hooks/useAchievements';
import AchievementBadge from './AchievementBadge';
import '../pages/achievements.css';

export default function AchievementNotice() {
  const { account } = useAccount();
  const client = useQueryClient();
  const { data, seen } = useAchievements();
  useEffect(() => {
    const refresh = () => { void client.invalidateQueries({ queryKey: ['achievements', account.user_id] }); };
    window.addEventListener('learning:changed', refresh);
    return () => window.removeEventListener('learning:changed', refresh);
  }, [account.user_id, client]);
  const unread = data?.items.filter(item => data.unread_ids.includes(item.id)) || [];
  if (!unread.length) return null;
  return <aside className="achievement-notice" aria-label="新成就通知">
    <AchievementBadge icon={unread[0].icon} unlocked />
    <div className="achievement-notice-copy" role="status"><span>成长值得被看见 · 解锁 {unread.length} 项成就</span>
      <strong>{unread.slice(0, 2).map(item => item.title).join('、')}{unread.length > 2 ? '…' : ''}</strong>
      <Link to="/achievements">查看我的成就 <ArrowUpRight size={14} /></Link>
      {seen.isError && <p role="alert">通知暂时无法标记已读，请重试。</p>}
    </div>
    <button className="achievement-dismiss" type="button" aria-label="关闭并标记这些成就通知为已读" disabled={seen.isPending}
      onClick={() => seen.mutate(unread.map(item => item.id))}><X size={17} /></button>
  </aside>;
}
