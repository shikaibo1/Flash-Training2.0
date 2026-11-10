export interface Skill {
  role_id?: string;
  context?: string;
  task_brief?: string;
  deliverable?: string;
  skill_id: string;
  name: string;
  display_name: string;
  description: string;
  atomic_skills: string[];
  generate_prompt: string;
  evaluate_prompt: string;
  enabled: boolean;
  default_params: Record<string, string>;
}

// 原子技能接口
export interface AtomicSkill {
  atomic_skill_id: string;
  name: string;
  description: string;
  action: string;
  input_spec: string;
  output_spec: string;
  boundary: string;
  rubric: string[];
  knowledge_ids: string[];
  prerequisite_ids: string[];
  contexts: string[];
  version: number;
  categories: string[];
  score?: number | null;
  current_score?: number | null;
}

// 自定义技能请求接口
export interface CustomSkillRequest {
  skill_name: string;
}

// 优化请求接口
export interface OptimizationRequest {
  user_id: string;
  atomic_skill_ids: string[];
  optimization_goal: string;
}

export interface SpeechEvaluationRequest {
  draft: string;
  scene: string;
  duration: string;
  keyword?: string;
}

export interface SpeechEvaluationResult {
  draft: string;
  scene: string;
  duration: string;
  total_score: number;
  avg_score: number;
  agent_details: Array<{
    agent_name: string;
    dimension: string;
    score: number;
    advice: string;
  }>;
  comprehensive_advice: string;
}

export interface CodeEvaluationRequest {
  code: string;
  optimize_type: string;
}

export interface PracticeSessionData {
  id: string;
  skillId: string;
  startTime: string;
  endTime?: string;
  score?: number | null;
}

// 添加练习内容接口
export interface PracticeContent {
  materials?: string;
  target_atomic_ids?: string[];
  agent_trace?: AgentTrace[];
  category: string;
  difficulty: string;
  title: string;
  description: string;
  hint?: string;
  example_answer?: string;
}

// 练习记录接口
export interface PracticeRecord {
  mode?: string;
  context?: string;
  assistance_used?: boolean;
  materials?: string;
  evidence?: EvidenceItem[];
  agent_trace?: AgentTrace[];
  title?: string;
  description?: string;
  hint?: string;
  example_answer?: string;
  session_id?: string;
  atomic_skill_scores?: Record<string, number>;
  atomic_skill_names?: Record<string, string>;
  user_id: string;
  skill_id: string;
  skill_name: string;
  category: string;
  difficulty: string;
  input_type: string; // voice 或 text
  transcript: string;
  score: number;
  strengths: string[];
  improvements: string[];
  ai_comment: string;
  record_id?: string;
  start_time: string;
  end_time: string;
}

export type AgentTrace = { agent: string; method: string; summary: string };
export type EvidenceStatus =
  "unmeasured" | "developing" | "assisted" | "independent" | "uncertain";
export type AtomEvidence = {
  atomic_skill_id: string;
  name: string;
  contexts: {
    context: string;
    status: EvidenceStatus;
    evidence_count: number;
    independent_count: number;
    last_score: number | null;
    last_practice_time: string | null;
  }[];
  transfer_observed: boolean;
};
export type EvidenceItem = {
  session_id?: string;
  atomic_skill_id: string;
  context?: string;
  mode?: string;
  assistance_used?: boolean;
  status: "observed" | "not_observable";
  score: number | null;
  quote: string;
  reason: string;
  next_action: string;
  created_at?: string;
};
export type EvidenceData = {
  atomic_skills: AtomEvidence[];
  recent_evidence: EvidenceItem[];
  project_observations?: import("./projects").ProjectObservation[];
};
export type GraphNode = {
  id: string;
  type: "role" | "task" | "atom" | "knowledge";
  label: string;
  description: string;
  reference_id: string;
};
export type GraphData = {
  nodes: GraphNode[];
  edges: {
    source: string;
    target: string;
    relation: "requires" | "supports" | "prerequisite" | "contains";
  }[];
  atoms: AtomicSkill[];
  tasks: Skill[];
  roles: { role_id: string; name: string; description: string }[];
  knowledge: {
    knowledge_id: string;
    name: string;
    description: string;
    course: string;
  }[];
};
export type Recommendation = {
  skill_id: string;
  title: string;
  context: string;
  reason: string;
  target_atomic_ids: string[];
};
