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
export type SetupPlan = components["schemas"]["SetupPlan"];
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
}
async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(10000)]);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.email) headers["Content-Type"] = "application/json";
  try {
    const response = await fetch(`/v1${path}`, {
      method: options.email ? "POST" : "GET",
      headers,
      signal,
      body: options.email
        ? JSON.stringify({ email: options.email })
        : undefined,
      cache: "no-store",
      credentials: "omit",
    });
    if (!response.ok) throw await readProblem(response);
    return (await response.json()) as T;
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
  workspace: (token: string, signal: AbortSignal) =>
    request<WorkspaceData>("/workspace", { token, signal }),
  plan: (slug: string, token: string, signal: AbortSignal) =>
    request<SetupPlan>(`/projects/${encodeURIComponent(slug)}/setup-plan`, {
      token,
      signal,
    }),
};
