import type { operations, components } from "./schema";
export type Me =
  operations["getMe"]["responses"][200]["content"]["application/json"];
export type Login =
  operations["devLogin"]["responses"][200]["content"]["application/json"];
export type WorkspaceData = components["schemas"]["Workspace"];
export type PluginItem = components["schemas"]["PluginItem"];
export type PluginVersion = components["schemas"]["PluginVersion"];
export type VersionPage = components["schemas"]["VersionPage"];
export type PluginPage = components["schemas"]["PluginPage"];
export type MarketplaceQuery = NonNullable<
  operations["listMarketplace"]["parameters"]["query"]
>;
export type GatewayToken = components["schemas"]["GatewayToken"];
export type GatewayTokenCreated = components["schemas"]["GatewayTokenCreated"];
export type GatewayTokenPage = components["schemas"]["GatewayTokenPage"];
export type GitHubRepository = components["schemas"]["GitHubRepository"];
export type RepositoryPage = components["schemas"]["RepositoryPage"];
export type RepositoryRegistration =
  components["schemas"]["RepositoryRegistration"];
export type RepositorySync = components["schemas"]["RepositorySync"];
export type SetupPlan = components["schemas"]["SetupPlan"];
// Hand-written until GET /v1/me/installations lands in the generated schema.
export interface Installations {
  cliVersion: string | null;
  reportedAt: string | null;
  plugins: { name: string; version: string; installedAt: string }[];
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public correlationId?: string,
  ) {
    super(code);
  }
}
interface RequestOptions {
  token?: string;
  signal: AbortSignal;
  email?: string;
  method?: "POST" | "DELETE";
  body?: unknown;
  timeoutMs?: number;
}
async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const signal = AbortSignal.any([
    options.signal,
    AbortSignal.timeout(options.timeoutMs ?? 10000),
  ]);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.email || options.body)
    headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`/v1${path}`, {
      method: options.method ?? (options.email ? "POST" : "GET"),
      headers,
      signal,
      body: options.email
        ? JSON.stringify({ email: options.email })
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw await readProblem(response);
    return response.status === 204
      ? (undefined as T)
      : ((await response.json()) as T);
  } catch (error) {
    if (options.signal.aborted)
      throw new DOMException("Cancelled", "AbortError");
    if (error instanceof ApiError) throw error;
    throw new ApiError(0, signal.aborted ? "timeout" : "network_error");
  }
}
export async function readProblem(response: Response): Promise<ApiError> {
  const value: unknown = await response.json().catch(() => null);
  const problem =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  return new ApiError(
    response.status,
    typeof problem.code === "string" ? problem.code : "http_error",
    typeof problem.correlation_id === "string"
      ? problem.correlation_id
      : undefined,
  );
}
export const api = {
  repositories: (
    cursor: string | undefined,
    token: string,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({ limit: "20" });
    if (cursor) params.set("cursor", cursor);
    return request<RepositoryPage>(`/repositories?${params}`, {
      token,
      signal,
    });
  },
  registerRepository: (
    body: RepositoryRegistration,
    token: string,
    signal: AbortSignal,
  ) =>
    request<GitHubRepository>("/repositories", {
      token,
      signal,
      method: "POST",
      body,
    }),
  syncRepository: (
    id: string,
    tag: string,
    token: string,
    signal: AbortSignal,
  ) =>
    request<RepositorySync>(`/repositories/${encodeURIComponent(id)}/sync`, {
      token,
      signal,
      method: "POST",
      body: { tag },
      timeoutMs: 250000,
    }),
  gatewayTokens: (
    cursor: string | undefined,
    token: string,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({ limit: "20" });
    if (cursor) params.set("cursor", cursor);
    return request<GatewayTokenPage>(`/me/gateway-tokens?${params}`, {
      token,
      signal,
    });
  },
  createGatewayToken: (name: string, token: string, signal: AbortSignal) =>
    request<GatewayTokenCreated>("/me/gateway-tokens", {
      token,
      signal,
      method: "POST",
      body: { name },
    }),
  revokeGatewayToken: (id: string, token: string, signal: AbortSignal) =>
    request<void>(`/me/gateway-tokens/${encodeURIComponent(id)}`, {
      token,
      signal,
      method: "DELETE",
    }),
  marketplace: (
    query: MarketplaceQuery,
    token: string,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
      if (value !== undefined && value !== "") params.set(name, String(value));
    }
    return request<PluginPage>(`/marketplace?${params}`, { token, signal });
  },
  plugin: (name: string, token: string, signal: AbortSignal) =>
    request<PluginItem>(`/plugins/${encodeURIComponent(name)}`, {
      token,
      signal,
    }),
  versions: (
    name: string,
    limit: number,
    cursor: string | undefined,
    token: string,
    signal: AbortSignal,
  ) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (cursor) params.set("cursor", cursor);
    return request<VersionPage>(
      `/plugins/${encodeURIComponent(name)}/versions?${params}`,
      { token, signal },
    );
  },
  login: (email: string, signal: AbortSignal) =>
    request<Login>("/auth/dev-login", { email, signal }),
  me: (token: string, signal: AbortSignal) =>
    request<Me>("/me", { token, signal }),
  installations: (token: string, signal: AbortSignal) =>
    request<Installations>("/me/installations", { token, signal }),
  workspace: (token: string, signal: AbortSignal) =>
    request<WorkspaceData>("/workspace", { token, signal }),
  plan: (slug: string, token: string, signal: AbortSignal) =>
    request<SetupPlan>(`/projects/${encodeURIComponent(slug)}/setup-plan`, {
      token,
      signal,
    }),
};
