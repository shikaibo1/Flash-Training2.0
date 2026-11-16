import { ArrowUpRight, Award } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAchievements } from '../hooks/useAchievements';
import AchievementBadge from './AchievementBadge';
import '../pages/achievements.css';

export default function AchievementSummary() {
  const { data, isError, isPending } = useAchievements();
  const earned = data?.items.filter(item => item.unlocked).slice(-3) || [];
  return <Link className="achievement-summary panel" to="/achievements">
    <div className="achievement-summary-copy"><span className="small-label"><Award size={15} /> 成长成就</span>
      <h2>{isPending ? '正在整理你的足迹…' : isError ? '查看我的成就' : data?.unlocked_count ? `${data.unlocked_count} 个认真学习的瞬间` : '从第一步开始，留下成长的印记'}</h2>
      <p>{isError ? '成就暂时无法读取，进入页面后可重试。' : '独立思考、主动反思、新题再试，都值得被记住。'}</p></div>
    <div className="achievement-summary-badges">{earned.length ? earned.map(item => <AchievementBadge key={item.id} icon={item.icon} unlocked />) : <AchievementBadge icon="sprout" unlocked={false} />}</div>
    <ArrowUpRight size={20} className="achievement-summary-arrow" />
  </Link>;
}
