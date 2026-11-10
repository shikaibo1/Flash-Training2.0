import type {
  Skill,
  PracticeContent,
  PracticeRecord,
  AtomicSkill,
  GraphData,
  EvidenceData,
  Recommendation,
  AgentTrace,
  EvidenceItem,
} from "../types";
import type { Project } from "../types/projects";

// Backend address only. GPT credentials are stored exclusively in backend/.env.ai.
const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:8001/api";
const part = encodeURIComponent;

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

type Envelope<T> = { error: false; msg: string; data: T };
export type SessionData = {
  session_id: string;
  skill_id: string;
  content: PracticeContent;
  start_time: string;
  status: "active" | "completed";
  mode?: string;
  atom_snapshot?: AtomicSkill[];
  agent_trace?: AgentTrace[];
  atomic_skill_names?: Record<string, string>;
  answer?: string;
  evaluation_result?: EvaluationData;
};
export type EvaluationData = {
  score: number;
  strengths: string[];
  improvements: string[];
  aiComment: string;
  atomic_skill_scores: Record<string, number>;
  evidence?: EvidenceItem[];
  agent_trace?: AgentTrace[];
};
export type Health = {
  status: string;
  database: string;
  ai_configured: boolean;
  ai_model: string;
  schema_version: number;
};

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  // Backend allows a 300s AI timeout plus a 15s database lock wait.
  const timeout = window.setTimeout(() => controller.abort(), 330000);
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...options.headers },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const detail =
        typeof body?.detail === "string"
          ? body.detail
          : body?.msg ||
            (Array.isArray(body?.detail)
              ? "填写的内容不符合要求，请检查后重试。"
              : undefined);
      throw new ApiError(
        detail || `请求失败（${response.status}）`,
        response.status,
        body?.code,
      );
    }
    if (!body)
      throw new ApiError("服务返回了无法读取的数据。", response.status);
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError(
        "等待响应超时，你的回答已保留，可以重试。",
        0,
        "request_timeout",
      );
    }
    throw new ApiError(
      "无法连接服务，请确认服务已启动后重试。",
      0,
      "network_error",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}

function post<T>(endpoint: string, value: unknown) {
  return request<T>(endpoint, { method: "POST", body: JSON.stringify(value) });
}

export const systemApi = { health: () => request<Health>("/health") };

export const projectApi = {
  list: () => request<{ projects: Project[] }>("/v3/projects"),
  get: (id: string) =>
    request<{ project: Project }>(`/v3/projects/${part(id)}`),
  create: (values: Record<string, unknown>) =>
    post<{ project: Project }>("/v3/projects", values),
  act: (id: string, values: Record<string, unknown>) =>
    post<{ project: Project }>(`/v3/projects/${part(id)}/actions`, values),
  draft: (id: string, values: Record<string, unknown>) =>
    post<{ project: Project }>(`/v3/projects/${part(id)}/draft`, values),
};

export const skillsApi = {
  getAllSkills: () => request<{ skills: Skill[] }>("/skills"),
  createCustomSkill: (skillName: string) =>
    post<{ skill: Skill; message: string }>("/skills/custom", {
      skill_name: skillName,
    }),
  deleteSkill: (skillId: string) =>
    request<{ message: string }>(`/skills/${part(skillId)}`, {
      method: "DELETE",
    }),
};

export const practiceApi = {
  getRecords: (userId: string) =>
    request<{ records: PracticeRecord[] }>(`/practice/records/${part(userId)}`),
  deleteRecord: (recordId: string, userId = "default_user") =>
    request<{ message: string }>(
      `/practice/record/${part(recordId)}?user_id=${part(userId)}`,
      { method: "DELETE" },
    ),
};

export const practiceV1Api = {
  getSession: (userId: string, sessionId: string) =>
    request<Envelope<SessionData>>(
      `/v1/practice/sessions/${part(sessionId)}?user_id=${part(userId)}`,
    ),
  startPractice: (
    userId: string,
    skillId: string,
    params: Record<string, unknown> = {},
  ) =>
    post<Envelope<SessionData>>("/v1/practice/start", {
      user_id: userId,
      skill_id: skillId,
      params,
    }),
  submitAnswer: (
    userId: string,
    sessionId: string,
    answer: string,
    assistanceUsed = false,
  ) =>
    post<
      Envelope<{
        session_id: string;
        evaluation_result: EvaluationData;
        record_id: string;
        status: string;
      }>
    >("/v1/practice/submit", {
      user_id: userId,
      session_id: sessionId,
      answer,
      assistance_used: assistanceUsed,
    }),
  getAvailableSkills: () => request<{ skills: Skill[] }>("/v1/practice/skills"),
};

export const careerApi = {
  graph: () => request<GraphData>("/v2/graph"),
  evidence: (userId = "default_user") =>
    request<EvidenceData>(`/v2/evidence/${part(userId)}`),
  recommendations: (userId = "default_user") =>
    request<{ recommendations: Recommendation[] }>(
      `/v2/recommendations/${part(userId)}`,
    ),
};
