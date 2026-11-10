import type { BridgeCatalog, BridgeSession } from "./bridge";
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
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:8001/api`;
const part = encodeURIComponent;

export type Account = { user_id: string; username: string; display_name: string };
let activeAccountId: string | null = null;
const pendingRequests = new Set<AbortController>();

export function setApiAccount(userId: string | null) {
  if (activeAccountId === userId) return;
  activeAccountId = userId;
  for (const controller of pendingRequests) controller.abort();
}

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
  bridge_case_id?: string | null;
  source_session_id?: string | null;
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
  const accountId = activeAccountId;
  const isAuth = endpoint.startsWith("/auth/");
  if (!accountId && !isAuth && endpoint !== "/health") {
    throw new ApiError("请先登录。", 401, "authentication_required");
  }
  const controller = new AbortController();
  pendingRequests.add(controller);
  // Backend allows a 300s AI timeout plus a 15s database lock wait.
  const timeout = window.setTimeout(() => controller.abort(), 330000);
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Requested-With": "FlashTrain",
        ...(accountId ? { "X-Account-ID": accountId } : {}), ...options.headers },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!isAuth && accountId !== activeAccountId) {
      throw new ApiError("账号状态已变化，请重新进入。", 401, "account_changed");
    }
    if (!response.ok) {
      if (response.status === 401 && (!isAuth || endpoint === "/auth/logout")) window.dispatchEvent(new Event("auth:expired"));
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
      if (accountId !== activeAccountId) throw new ApiError("账号状态已变化，请重新进入。", 401, "account_changed");
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
    pendingRequests.delete(controller);
    window.clearTimeout(timeout);
  }
}

function post<T>(endpoint: string, value: unknown) {
  return request<T>(endpoint, { method: "POST", body: JSON.stringify(value) });
}

export const systemApi = { health: () => request<Health>("/health") };

export const authApi = {
  me: () => request<Account>("/auth/me"),
  login: (username: string, password: string) => post<Account>("/auth/login", { username, password }),
  register: (username: string, password: string, displayName: string) =>
    post<Account>("/auth/register", { username, password, display_name: displayName }),
  logout: () => post<{ message: string }>("/auth/logout", {}),
};

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
  getRecords: () =>
    request<{ records: PracticeRecord[] }>("/practice/records"),
  deleteRecord: (recordId: string) =>
    request<{ message: string }>(
      `/practice/record/${part(recordId)}`,
      { method: "DELETE" },
    ),
};

export const practiceV1Api = {
  getSession: (sessionId: string) =>
    request<Envelope<SessionData>>(
      `/v1/practice/sessions/${part(sessionId)}`,
    ),
  startPractice: (
    skillId: string,
    params: Record<string, unknown> = {},
  ) =>
    post<Envelope<SessionData>>("/v1/practice/start", {
      skill_id: skillId,
      params,
    }),
  submitAnswer: (
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
      session_id: sessionId,
      answer,
      assistance_used: assistanceUsed,
    }),
  getAvailableSkills: () => request<{ skills: Skill[] }>("/v1/practice/skills"),
};

export const careerApi = {
  graph: () => request<GraphData>("/v2/graph"),
  evidence: () =>
    request<EvidenceData>("/v2/evidence"),
  recommendations: () =>
    request<{ recommendations: Recommendation[] }>(
      "/v2/recommendations",
    ),
};

export const bridgeApi = {
  catalog: () => request<Envelope<BridgeCatalog>>("/v2/bridge/catalog"),
  session: (sessionId: string) =>
    request<Envelope<BridgeSession>>(
      `/v2/bridge/sessions/${part(sessionId)}`,
    ),
  diagnose: (
    sessionId: string,
    answers: Record<string, string>,
  ) =>
    post<Envelope<BridgeSession>>(
      `/v2/bridge/sessions/${part(sessionId)}/diagnosis`,
      { answers },
    ),
};
