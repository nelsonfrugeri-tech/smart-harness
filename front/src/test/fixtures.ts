import type { Me, SetupPlan, WorkspaceData } from "../api/client";
export const me: Me = {
  user: { id: "dev-one", name: "Development One", email: "dev@example.com" },
  memberships: [
    {
      tenant: { id: "tenant-one", slug: "finance", name: "Finance Squad" },
      role: "DEV",
    },
  ],
};
export const projects: WorkspaceData["projects"] = [
  {
    slug: "investimentos-api",
    name: "Investimentos",
    description: "Investment services",
    tenant: { slug: "finance", name: "Finance Squad" },
    counts: { agent: 1, skill: 1, mcp: 0 },
    baseline: [{ plugin: "investment-base", version: "1.0.0" }],
  },
  {
    slug: "conta-digital",
    name: "Conta",
    description: "Accounts",
    tenant: { slug: "finance", name: "Finance Squad" },
    counts: { agent: 1, skill: 0, mcp: 0 },
    baseline: [],
  },
];
export const plan: SetupPlan = {
  project: projects[0],
  gateway: { url: "http://localhost:8081" },
  optional: { items: [], next_cursor: null },
  baseline: [
    {
      plugin: {
        name: "investment-base",
        description: "Base package",
        tenant: projects[0].tenant,
      },
      version: {
        version: "1.0.0",
        description: "Pinned baseline",
        visibility: "squad",
        digest: `sha256:${"a".repeat(64)}`,
        published_at: "2026-01-01T00:00:00Z",
        size_bytes: 100,
        archive_url: "/v1/archive",
      },
      components: [
        {
          kind: "agent",
          name: "investment-guide",
          description: "Project context",
        },
        {
          kind: "skill",
          name: "go-practices",
          description: "Language guidelines",
        },
      ],
    },
  ],
};
export const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
export function respond(input: RequestInfo | URL) {
  const path = String(input);
  if (path.endsWith("/dev-login"))
    return json({
      access_token: "token-one",
      token_type: "Bearer",
      expires_in: 3600,
    });
  if (path.endsWith("/me")) return json(me);
  if (path.endsWith("/workspace")) return json({ user: me.user, projects });
  if (path.includes("/investimentos-api/setup-plan")) return json(plan);
  if (path.includes("/conta-digital/setup-plan"))
    return json({ ...plan, project: projects[1], baseline: [] });
  return json({ code: "not_found", correlation_id: "missing-project" }, 404);
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
