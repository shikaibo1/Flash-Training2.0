export type AchievementCategory = '开始行动' | '主动理解' | '独立验证';

export type Achievement = {
  id: string;
  title: string;
  description: string;
  category: AchievementCategory;
  icon: string;
  target: number;
  rule_version: number;
  action_label: string;
  action_path: string;
  progress: number;
  unlocked: boolean;
  award: {
    achievement_id: string;
    achieved_at: string;
    awarded_at: string;
    source_path: string;
    source_label: string;
    rule_version: number;
    seen_at: string | null;
  } | null;
};

export type AchievementDashboard = {
  items: Achievement[];
  unlocked_count: number;
  total: number;
  unread_ids: string[];
  completed_tasks: number;
  independent_tasks: number;
  independent_atoms: number;
};
