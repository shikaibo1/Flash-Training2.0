import type { EvidenceStatus, GraphData, Recommendation } from '../types';

export type GoalAtomState = {
  atomic_skill_id: string;
  context: string;
  status: EvidenceStatus;
  evidence_count: number;
  independent_count: number;
  last_score: number | null;
  last_practice_time: string | null;
};
export type ProjectGraphPlan = {
  project_id: string;
  goal: string;
  context: string | null;
  task_id: string | null;
  status: string;
  scope_note: string;
  graph: GraphData;
  target_atom_ids: string[];
  prerequisite_atom_ids: string[];
  states: GoalAtomState[];
  recommendations: Recommendation[];
  warnings: string[];
};
export type EvidenceTimelineItem = {
  id: string;
  source: 'practice' | 'project';
  context: string;
  stage: 'practice' | 'initial' | 'probe' | 'verification';
  mode: string | null;
  assistance_used: boolean;
  status: EvidenceStatus;
  quote: string;
  reason: string;
  next_action: string;
  created_at: string;
  score: number | null;
  session_id: string | null;
  skill_id: string | null;
  project_id: string | null;
  round_id: string | null;
  title: string;
  definition_version: number | null;
};
export type EvidenceTimeline = {
  atomic_skill_id: string;
  items: EvidenceTimelineItem[];
  contexts: string[];
  total: number;
  offset: number;
  limit: number;
};
