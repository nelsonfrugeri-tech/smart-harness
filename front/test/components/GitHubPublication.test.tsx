import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App";
import { deferred, json, me, respond } from "../../src/test/fixtures";

beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace");
});
afterEach(() => vi.unstubAllGlobals());

it("lets an admin open GitHub publication with keyboard focus and restore it on close", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/v1/me")
        return json({
          ...me,
          memberships: me.memberships.map((membership) => ({
            ...membership,
            role: "ADMIN",
          })),
        });
      if (
        path.startsWith("/v1/marketplace") ||
        path.startsWith("/v1/repositories")
      )
        return json({ items: [], next_cursor: null });
      return respond(input);
    }),
  );
  render(<App />);
  const trigger = await screen.findByRole("button", {
    name: "Publicar do GitHub",
  });
  const user = userEvent.setup();
  trigger.focus();
  await user.keyboard("{Enter}");
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Publicar do GitHub" }),
  );
  await user.click(screen.getByRole("button", { name: "Fechar publicação" }));
  expect(document.activeElement).toBe(trigger);
  expect(
    screen.queryByRole("region", { name: "Publicar do GitHub" }),
  ).toBeNull();
});

it("keeps publication unavailable to non-admin users without listing repositories", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith("/v1/marketplace")
      ? json({ items: [], next_cursor: null })
      : respond(input),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  await screen.findByRole("heading", { name: "Marketplace" });
  expect(
    screen.queryByRole("button", { name: "Publicar do GitHub" }),
  ).toBeNull();
  expect(
    fetcher.mock.calls.some(([input]) =>
      String(input).startsWith("/v1/repositories"),
    ),
  ).toBe(false);
});

const repository = {
  id: "repository-one",
  owner: "demo-team",
  repo: "agent-md2poui",
  repository_url: "https://github.com/demo-team/agent-md2poui",
  tenant: me.memberships[0].tenant,
  visibility: "squad",
  created_at: "2026-10-22T12:00:00Z",
  last_synced_at: null,
  last_sync: null,
};
const synced = {
  status: "created",
  plugin: "agent-md2poui",
  version: "1.0.0",
  digest: `sha256:${"a".repeat(64)}`,
  commit_sha: "b".repeat(40),
  release_url: "https://github.com/demo-team/agent-md2poui/releases/tag/v1.0.0",
};
function publicationApi(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/v1/me")
        return json({
          ...me,
          memberships: [
            { ...me.memberships[0], role: "ADMIN" },
            {
              tenant: { id: "other-squad", slug: "other", name: "Other Squad" },
              role: "ADMIN",
            },
          ],
        });
      if (url.pathname.startsWith("/v1/repositories"))
        return handler(url, init);
      if (url.pathname === "/v1/marketplace")
        return json({ items: [], next_cursor: null });
      return respond(input);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function openPublication() {
  render(<App />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Publicar do GitHub" }),
  );
  return user;
}
it("registers the selected squad and visibility then publishes and refreshes the catalog", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  const fetcher = publicationApi((url, init) => {
    if (init?.method === "POST") {
      calls.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return url.pathname.endsWith("/sync")
        ? json(synced)
        : json(repository, 201);
    }
    return json({ items: [], next_cursor: null });
  });
  const user = await openPublication();
  await user.type(
    screen.getByRole("textbox", { name: "URL do repositório" }),
    "https://github.com/demo-team/agent-md2poui.git",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Squad responsável" }),
    "other-squad",
  );
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Quem pode instalar" }),
    "organization",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.click(screen.getByRole("button", { name: "Publicar versão" }));
  expect(
    await screen.findByRole("link", { name: "Ver pacote no Marketplace" }),
  ).toHaveProperty("pathname", "/marketplace/packages/agent-md2poui");
  expect(calls).toEqual([
    {
      path: "/v1/repositories",
      body: {
        owner: "demo-team",
        repo: "agent-md2poui",
        tenant_id: "other-squad",
        visibility: "organization",
      },
    },
    { path: "/v1/repositories/repository-one/sync", body: { tag: "v1.0.0" } },
  ]);
  expect(
    fetcher.mock.calls.filter(([input]) =>
      String(input).startsWith("/v1/marketplace"),
    ),
  ).toHaveLength(2);
  expect(
    screen.getByRole("combobox", { name: "Repositório cadastrado" }),
  ).toHaveProperty("value", "repository-one");
});
it("keeps a registered repository and release on sync failure then retries only sync", async () => {
  let registrations = 0;
  let syncs = 0;
  publicationApi((url, init) => {
    if (url.pathname.endsWith("/sync")) {
      syncs++;
      return syncs === 1
        ? json(
            { code: "invalid_package", correlation_id: "validation-trace" },
            422,
          )
        : json(synced);
    }
    if (init?.method === "POST") {
      registrations++;
      return json(repository, 201);
    }
    return json({ items: [], next_cursor: null });
  });
  const user = await openPublication();
  await user.type(
    screen.getByRole("textbox", { name: "URL do repositório" }),
    "demo-team/agent-md2poui",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.click(screen.getByRole("button", { name: "Publicar versão" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("não passou na validação"),
  );
  expect(
    screen.getByRole("textbox", { name: "Tag da release" }),
  ).toHaveProperty("value", "v1.0.0");
  expect(
    screen.getByRole("combobox", { name: "Repositório cadastrado" }),
  ).toHaveProperty("value", "repository-one");
  await user.click(
    screen.getByRole("button", { name: "Tentar publicar novamente" }),
  );
  await screen.findByRole("link", { name: "Ver pacote no Marketplace" });
  expect(registrations).toBe(1);
  expect(syncs).toBe(2);
});
it("loads existing repositories by cursor and syncs a selected release without registration", async () => {
  const cursors: Array<string | null> = [];
  let registration = false;
  publicationApi((url, init) => {
    if (url.pathname.endsWith("/sync"))
      return json({ ...synced, status: "unchanged" });
    if (init?.method === "POST") registration = true;
    cursors.push(url.searchParams.get("cursor"));
    return url.searchParams.has("cursor")
      ? json({ items: [repository], next_cursor: null })
      : json({ items: [], next_cursor: "opaque+/=" });
  });
  const user = await openPublication();
  await user.click(
    await screen.findByRole("button", { name: "Carregar mais repositórios" }),
  );
  await screen.findByRole("option", {
    name: "demo-team/agent-md2poui · Finance Squad",
  });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Repositório cadastrado" }),
    "repository-one",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.click(screen.getByRole("button", { name: "Publicar versão" }));
  await screen.findByText("Versão já disponível");
  expect(cursors).toEqual([null, "opaque+/="]);
  expect(registration).toBe(false);
  expect(
    screen.queryByRole("button", { name: "Carregar mais repositórios" }),
  ).toBeNull();
});
it.each([
  "https://token@github.com/demo-team/project",
  "https://example.com/demo-team/project",
  "https://github.com/demo-team/project/tree/main",
])("rejects a non-repository URL before registration: %s", async (input) => {
  const fetcher = publicationApi(() => json({ items: [], next_cursor: null }));
  const user = await openPublication();
  await user.type(
    screen.getByRole("textbox", { name: "URL do repositório" }),
    input,
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.click(screen.getByRole("button", { name: "Publicar versão" }));
  expect(
    screen
      .getByRole("textbox", { name: "URL do repositório" })
      .getAttribute("aria-invalid"),
  ).toBe("true");
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
    false,
  );
});
it("expires a session when repository access returns 401", async () => {
  publicationApi(() => json({ code: "invalid_token" }, 401));
  await openPublication();
  await screen.findByRole("textbox", { name: "Email" });
  expect(sessionStorage.length).toBe(0);
  expect(
    screen.queryByRole("region", { name: "Publicar do GitHub" }),
  ).toBeNull();
});

it("prevents duplicate publication while pending and aborts on logout without stale success", async () => {
  const pending = deferred<Response>();
  let syncs = 0;
  let signal: AbortSignal | undefined;
  publicationApi((url, init) => {
    if (url.pathname.endsWith("/sync")) {
      syncs++;
      signal = init?.signal as AbortSignal;
      return pending.promise;
    }
    return json({ items: [repository], next_cursor: null });
  });
  const user = await openPublication();
  await screen.findByRole("option", {
    name: "demo-team/agent-md2poui · Finance Squad",
  });
  await user.selectOptions(
    screen.getByRole("combobox", { name: "Repositório cadastrado" }),
    "repository-one",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.dblClick(screen.getByRole("button", { name: "Publicar versão" }));
  await screen.findByText("Validando e publicando a versão…");
  expect(syncs).toBe(1);
  expect(
    screen.getByRole("textbox", { name: "Tag da release" }).closest("fieldset"),
  ).toHaveProperty("disabled", true);
  await user.click(screen.getByRole("button", { name: "Sair" }));
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.resolve(json(synced)));
  expect(
    screen.queryByRole("link", { name: "Ver pacote no Marketplace" }),
  ).toBeNull();
  expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
});
it("preserves a repository name after registration fails", async () => {
  publicationApi((_url, init) =>
    init?.method === "POST"
      ? json({ code: "repository_exists" }, 409)
      : json({ items: [], next_cursor: null }),
  );
  const user = await openPublication();
  await user.type(
    screen.getByRole("textbox", { name: "URL do repositório" }),
    "demo-team/agent-md2poui",
  );
  await user.type(
    screen.getByRole("textbox", { name: "Tag da release" }),
    "v1.0.0",
  );
  await user.click(screen.getByRole("button", { name: "Publicar versão" }));
  await screen.findByRole("alert");
  expect(
    screen.getByRole("textbox", { name: "URL do repositório" }),
  ).toHaveProperty("value", "demo-team/agent-md2poui");
  expect(
    screen.getByRole("textbox", { name: "Tag da release" }),
  ).toHaveProperty("value", "v1.0.0");
  expect(
    screen.getByRole("combobox", { name: "Squad responsável" }),
  ).toHaveProperty("value", "tenant-one");
});
