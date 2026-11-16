export type PlanModule = { key: string; name: string; description: string };
export type PlanAtom = {
  key: string;
  module_key: string;
  name: string;
  action: string;
  input_spec: string;
  output_spec: string;
  boundary: string;
  rubric: string[];
  prerequisite_keys: string[];
  diagnostic_question: string;
  basis: "user_material" | "proposal";
  source_quote: string;
  applicability_conditions: string[];
  common_misuses: string[];
};
export type LearningPlan = {
  disposition: "ready" | "needs_clarification";
  title: string;
  scope: string;
  context: string;
  deliverable: string;
  exclusions: string;
  questions: string[];
  modules: PlanModule[];
  atoms: PlanAtom[];
};
