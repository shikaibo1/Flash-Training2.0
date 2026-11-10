export type BridgeCase = {
  case_id: string;
  version: number;
  comparison_version: number;
  title: string;
  stage: 'baseline' | 'representation' | 'boundary' | 'synthesis';
  description: string;
  changed_condition: string;
  controlled_conditions: string[];
  target_atomic_ids: string[];
  allowed_modes: string[];
  requires_source: boolean;
};

export type BridgeCatalog = {
  skill_id: string;
  title: string;
  description: string;
  limitations: string[];
  cases: BridgeCase[];
};

export type BridgeSession = {
  session_id: string;
  status: string;
  case: BridgeCase;
  source_session_id: string | null;
  assistance_used: boolean | null;
  comparison: {
    status: 'pending' | 'unpaired' | 'assisted' | 'not_comparable' | 'comparable';
    reason: string;
    source_session_id: string | null;
    atoms: { atomic_skill_id: string; baseline_score: number; current_score: number; difference: number }[];
    limitations: string[];
  };
  diagnosis: {
    status: 'unavailable' | 'available' | 'completed';
    message: string;
    probes: { probe_id: string; atomic_skill_id: string; question: string; options: { option_id: string; label: string }[] }[];
    hypotheses: { hypothesis_id: string; atomic_skill_id: string; statement: string }[];
    result: null | {
      answers: Record<string, string>;
      findings: { hypothesis_id: string; atomic_skill_id: string; status: 'supported' | 'refuted' | 'insufficient'; correct: boolean; explanation: string }[];
      recommendations: { atomic_skill_id: string; knowledge_ids: string[]; courses: string[]; reason: string; practice: { skill_id: string; params: { bridge_case_id: string; mode: string; target_atomic_ids: string[] } } }[];
      limitations: string[];
      submitted_at: string;
    };
  };
};

export const bridgeStages = { baseline: '基线练习', representation: '表征变式', boundary: '条件边界变式', synthesis: '综合交付' };
export const practiceModes: Record<string, string> = { guided: '引导练习', independent: '独立练习', transfer: '迁移练习' };

export function bridgePracticeUrl(skillId: string, caseId: string, mode: string, atoms: string[], sourceSessionId?: string) {
  const search = new URLSearchParams({ bridge_case_id: caseId, mode, atoms: atoms.join(',') });
  if (sourceSessionId) search.set('source_session_id', sourceSessionId);
  return `/practice/${encodeURIComponent(skillId)}?${search}`;
}
