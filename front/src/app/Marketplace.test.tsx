import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { json, plan, respond } from "../test/fixtures";
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace?kind=skill&q=go&limit=1");
});
it("discovers whole packages using API filters from a reloadable URL", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).startsWith("/v1/marketplace")
      ? json({ items: plan.baseline, next_cursor: null })
      : respond(input),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "investment-base" }),
  ).toBeTruthy();
  expect(screen.getByText("investment-guide")).toBeTruthy();
  expect(screen.getByText("go-practices")).toBeTruthy();
  const request = fetcher.mock.calls
    .map(([input]) => String(input))
    .find((path) => path.startsWith("/v1/marketplace"));
  expect(new URL(request!, "http://localhost").searchParams.get("kind")).toBe(
    "skill",
  );
  expect(new URL(request!, "http://localhost").searchParams.get("q")).toBe(
    "go",
  );
});

import { act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { deferred, me } from "../test/fixtures";
const first = plan.baseline[0];
const second = { ...first, plugin: { ...first.plugin, name: "review-tools" } };
function mockMarketplace(
  handler: (url: URL, init?: RequestInit) => Response | Promise<Response>,
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/v1/marketplace"
        ? handler(url, init)
        : respond(input);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
it("loads opaque cursor pages, deduplicates packages and stops at null", async () => {
  const cursor = "opaque+/=cursor";
  const requests: string[] = [];
  mockMarketplace((url) => {
    requests.push(url.searchParams.get("cursor") ?? "first");
    return url.searchParams.has("cursor")
      ? json({ items: [first, second], next_cursor: null })
      : json({ items: [first], next_cursor: cursor });
  });
  render(<App />);
  await screen.findByRole("heading", { name: "investment-base" });
  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await screen.findByRole("heading", { name: "review-tools" });
  expect(
    screen.getAllByRole("heading", { name: "investment-base" }),
  ).toHaveLength(1);
  expect(requests).toEqual(["first", cursor]);
  expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  expect(screen.getByText("2 pacotes carregados")).toBeTruthy();
});
it("preserves loaded items after incremental failure and retries the same cursor", async () => {
  let moreAttempts = 0;
  mockMarketplace((url) => {
    if (!url.searchParams.has("cursor"))
      return json({ items: [first], next_cursor: "page-two" });
    expect(url.searchParams.get("cursor")).toBe("page-two");
    moreAttempts++;
    return moreAttempts === 1
      ? json({ code: "unavailable", correlation_id: "page-trace" }, 503)
      : json({ items: [second], next_cursor: null });
  });
  render(<App />);
  await screen.findByRole("button", { name: "Carregar mais" });
  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("heading", { name: "investment-base" })).toBeTruthy();
  expect(screen.getByText("page-trace")).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Tentar novamente" }),
  );
  expect(
    await screen.findByRole("heading", { name: "review-tools" }),
  ).toBeTruthy();
  expect(moreAttempts).toBe(2);
});
it("restarts invalid cursor pagination from the first page", async () => {
  let firstRequests = 0;
  mockMarketplace((url) => {
    if (url.searchParams.has("cursor"))
      return json({ code: "invalid_cursor" }, 400);
    firstRequests++;
    return json({ items: [first], next_cursor: "expired-page" });
  });
  render(<App />);
  await screen.findByRole("button", { name: "Carregar mais" });
  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  await userEvent.click(
    await screen.findByRole("button", { name: "Reiniciar consulta" }),
  );
  await screen.findByRole("button", { name: "Carregar mais" });
  expect(firstRequests).toBe(2);
  expect(
    screen.getAllByRole("heading", { name: "investment-base" }),
  ).toHaveLength(1);
});
it("resets pages on filter changes, ignores delayed pages and preserves filter focus", async () => {
  const pending = deferred<Response>();
  let oldSignal: AbortSignal | undefined;
  mockMarketplace((url, init) => {
    if (url.searchParams.get("kind") === "mcp") {
      expect(url.searchParams.has("cursor")).toBe(false);
      return json({ items: [second], next_cursor: null });
    }
    if (url.searchParams.has("cursor")) {
      oldSignal = init?.signal as AbortSignal;
      return pending.promise;
    }
    return json({ items: [first], next_cursor: "page-two" });
  });
  render(<App />);
  await screen.findByRole("button", { name: "Carregar mais" });
  await userEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
  const filter = screen.getByRole("combobox", { name: "Pacotes contendo" });
  await userEvent.selectOptions(filter, "mcp");
  expect(document.activeElement).toBe(filter);
  await screen.findByRole("heading", { name: "review-tools" });
  await act(async () =>
    pending.resolve(json({ items: [first], next_cursor: "more" })),
  );
  expect(oldSignal?.aborted).toBe(true);
  expect(screen.queryByRole("heading", { name: "investment-base" })).toBeNull();
  expect(location.search).toContain("kind=mcp");
});
it("submits shell search by keyboard and reloads filters on browser navigation", async () => {
  mockMarketplace((url) =>
    json({
      items: url.searchParams.get("q") === "review" ? [second] : [first],
      next_cursor: null,
    }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "investment-base" });
  const user = userEvent.setup();
  const search = screen.getByRole("searchbox", {
    name: "Buscar pacotes e componentes",
  });
  await user.clear(search);
  await user.type(search, "review{Enter}");
  await screen.findByRole("heading", { name: "review-tools" });
  expect(location.search).toContain("q=review");
  expect(document.activeElement).toBe(search);
  await act(async () => {
    history.replaceState(
      null,
      "",
      "/marketplace?kind=mcp&project=investimentos-api",
    );
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByRole("heading", { name: "investment-base" });
  expect(
    screen.getByRole("combobox", { name: "Pacotes contendo" }),
  ).toHaveProperty("value", "mcp");
  expect(screen.getByRole("combobox", { name: "Contexto" })).toHaveProperty(
    "value",
    "investimentos-api",
  );
  expect(screen.getByRole("searchbox")).toHaveProperty("value", "");
  expect(document.activeElement).toBe(search);
});
it("opens the selected package and keeps query context on return", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.startsWith("/v1/marketplace"))
        return json({ items: [first], next_cursor: null });
      if (path === "/v1/plugins/investment-base") return json(first);
      return respond(input);
    }),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("link", { name: "investment-base" }),
  );
  expect(location.pathname).toBe("/marketplace/packages/investment-base");
  expect(location.search).toBe("?kind=skill&q=go&limit=1");
  await screen.findByRole("heading", { name: "Componentes do pacote" });
  await userEvent.click(
    screen.getByRole("link", { name: "Voltar aos resultados" }),
  );
  await screen.findByRole("heading", { name: "investment-base" });
  expect(location.pathname).toBe("/marketplace");
  expect(location.search).toBe("?kind=skill&q=go&limit=1");
});
it.each([403, 404])(
  "distinguishes unavailable project context from an empty search (%s)",
  async (status) => {
    mockMarketplace(() => json({ code: "not_found" }, status));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("Conteúdo indisponível"),
    );
    expect(screen.queryByText("Nenhum pacote encontrado")).toBeNull();
  },
);
it("renders empty search with a clear recovery link", async () => {
  mockMarketplace(() => json({ items: [], next_cursor: null }));
  render(<App />);
  await screen.findByText("Nenhum pacote encontrado");
  expect(screen.getByRole("link", { name: "Limpar filtros" })).toHaveProperty(
    "search",
    "?limit=1",
  );
});
it("distinguishes a user without memberships from empty search", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/me"))
        return json({ ...me, memberships: [] });
      if (String(input).startsWith("/v1/marketplace"))
        return json({ items: [], next_cursor: null });
      return respond(input);
    }),
  );
  render(<App />);
  expect(await screen.findByText("Nenhum acesso ao Marketplace")).toBeTruthy();
  expect(screen.queryByText("Nenhum pacote encontrado")).toBeNull();
});
it("expires the session on a paginated 401 without retaining loaded items", async () => {
  mockMarketplace((url) =>
    url.searchParams.has("cursor")
      ? json({ code: "invalid_token" }, 401)
      : json({ items: [first], next_cursor: "page-two" }),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Carregar mais" }),
  );
  await screen.findByRole("textbox", { name: "Email" });
  expect(screen.queryByRole("heading", { name: "investment-base" })).toBeNull();
  expect(sessionStorage.length).toBe(0);
});
it("aborts pending marketplace requests on logout and ignores a delayed response", async () => {
  const pending = deferred<Response>();
  let signal: AbortSignal | undefined;
  mockMarketplace((_url, init) => {
    signal = init?.signal as AbortSignal;
    return pending.promise;
  });
  render(<App />);
  await screen.findByText("Carregando pacotes…");
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await act(async () =>
    pending.resolve(json({ items: [first], next_cursor: null })),
  );
  expect(signal?.aborted).toBe(true);
  expect(screen.queryByRole("heading", { name: "investment-base" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
});
it("rejects invalid URL limits without requesting a catalogue", async () => {
  history.replaceState(null, "", "/marketplace?limit=101");
  const fetcher = mockMarketplace(() => json({ items: [], next_cursor: null }));
  render(<App />);
  await screen.findByText("Filtros inválidos");
  expect(
    fetcher.mock.calls.some(([input]) =>
      String(input).includes("/v1/marketplace"),
    ),
  ).toBe(false);
});
it("prevents duplicate incremental requests while loading", async () => {
  const pending = deferred<Response>();
  let count = 0;
  mockMarketplace((url) => {
    if (url.searchParams.has("cursor")) {
      count++;
      return pending.promise;
    }
    return json({ items: [first], next_cursor: "page-two" });
  });
  render(<App />);
  const button = await screen.findByRole("button", { name: "Carregar mais" });
  await userEvent.dblClick(button);
  expect(button).toHaveProperty("disabled", true);
  expect(count).toBe(1);
  await act(async () =>
    pending.resolve(json({ items: [second], next_cursor: null })),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Carregando mais…" }),
    ).toBeNull(),
  );
});

it.each([200, 401])(
  "keeps the new account isolated from a previous marketplace response (%s)",
  async (status) => {
    const pending = deferred<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = String(input);
        const isNew =
          (init?.headers as Record<string, string>)?.Authorization ===
          "Bearer token-two";
        if (path.endsWith("/dev-login"))
          return json({
            access_token: "token-two",
            token_type: "Bearer",
            expires_in: 3600,
          });
        if (isNew && path.endsWith("/me"))
          return json({
            ...me,
            user: { ...me.user, id: "dev-two", name: "Development Two" },
          });
        if (path.startsWith("/v1/marketplace"))
          return isNew
            ? json({ items: [second], next_cursor: null })
            : pending.promise;
        return respond(input);
      }),
    );
    render(<App />);
    await screen.findByText("Carregando pacotes…");
    await userEvent.click(screen.getByRole("button", { name: "Sair" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Email" }),
      "other@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    await userEvent.click(
      await screen.findByRole("link", { name: "Marketplace" }),
    );
    await screen.findByRole("heading", { name: "review-tools" });
    await act(async () =>
      pending.resolve(
        status === 200
          ? json({ items: [first], next_cursor: null })
          : json({ code: "invalid_token" }, 401),
      ),
    );
    expect(
      screen.queryByRole("heading", { name: "investment-base" }),
    ).toBeNull();
    expect(screen.getByRole("heading", { name: "review-tools" })).toBeTruthy();
    expect(sessionStorage.getItem("smart-harness.access-token")).toBe(
      "token-two",
    );
  },
);
it("preserves punctuation in direct search URLs", async () => {
  history.replaceState(null, "", "/marketplace?q=where?here");
  const fetcher = mockMarketplace(() => json({ items: [], next_cursor: null }));
  render(<App />);
  await screen.findByText("Nenhum pacote encontrado");
  const request = fetcher.mock.calls
    .map(([input]) => String(input))
    .find((path) => path.startsWith("/v1/marketplace"));
  expect(new URL(request!, "http://localhost").searchParams.get("q")).toBe(
    "where?here",
  );
});
