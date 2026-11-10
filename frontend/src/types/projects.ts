import type { AtomicSkill, PracticeContent, Skill } from "../types";

export type Finding = {
  atomic_skill_id: string;
  state: "supported" | "gap" | "uncertain";
  quote: string;
  reason: string;
  next_action: string;
  issue: string;
};
export type ProjectRound = {
  round_id: string;
  stage: "initial" | "probe" | "verification";
  content: PracticeContent;
  target_ids: string[];
  answer: string;
  draft: string;
  draft_number: number;
  numeric_answer: number | null;
  assistance_used: boolean;
  assessment: { summary: string; findings: Finding[] } | null;
  variant: number | null;
};
export type Project = {
  project_id: string;
  user_id: string;
  goal: string;
  background: string;
  deliverable: string;
  source_text: string;
  status:
    | "pending"
    | "ready"
    | "answering"
    | "probing"
    | "support"
    | "review"
    | "completed";
  scope_note: string;
  skill: Skill | null;
  atoms: AtomicSkill[];
  rounds: ProjectRound[];
  findings: Finding[];
  interventions: {
    atomic_skill_id: string;
    level: string;
    title: string;
    text: string;
    exercise: string;
    source: string;
  }[];
  events: {
    event_id: string;
    kind: string;
    summary: string;
    decision: string | null;
    created_at: string;
    round_id: string | null;
  }[];
  decision_reason: string;
  probe_limit: number;
  probes_used: number;
  cycle: number;
  revision: number;
  updated_at: string;
};
export type ProjectObservation = {
  observation_id: string;
  project_id: string;
  round_id: string;
  atomic_skill_id: string;
  context: string;
  stage: string;
  assistance_used: boolean;
  finding: Finding;
  created_at: string;
};
export const projectStatus = {
  pending: "待规划",
  ready: "待开始",
  answering: "正在作答",
  probing: "简短确认",
  support: "针对性补弱",
  review: "待独立复测",
  completed: "本次复测通过",
};
export const findingLabels = {
  supported: "已有支持证据",
  gap: "发现明确缺口",
  uncertain: "尚不确定",
};
export const SQL_TASK = "task_sql_grain_v1";
