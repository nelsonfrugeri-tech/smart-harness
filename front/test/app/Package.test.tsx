import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createHash, webcrypto } from "node:crypto";
import { gzipSync } from "node:zlib";
import { App } from "../../src/app/App";
import { deferred, json, plan, respond } from "../../src/test/fixtures";
const bytes = Uint8Array.from(gzipSync("Package test archive"));
const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const current = {
  ...plan.baseline[0],
  version: {
    ...plan.baseline[0].version,
    size_bytes: bytes.length,
    digest,
    archive_url: "/v1/plugins/investment-base/versions/1.0.0/archive",
  },
};
// Publication order deliberately differs from semantic version order.
const older = {
  ...current.version,
  version: "9.0.0",
  archive_url: "/v1/plugins/investment-base/versions/9.0.0/archive",
};
const archive = () =>
  new Response(bytes, {
    headers: { "content-type": "application/gzip", "x-package-digest": digest },
  });
function installApi(
  history: (url: URL) => Response | Promise<Response> = () =>
    json({ items: [current.version], next_cursor: null }),
  download = (): Response | Promise<Response> => archive(),
) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, _options?: RequestInit) => {
      void _options;
      const url = new URL(String(input), "http://localhost");
      if (url.pathname.endsWith("/archive")) return download();
      if (url.pathname.endsWith("/versions")) return history(url);
      if (url.pathname === "/v1/plugins/investment-base") return json(current);
      if (url.pathname.endsWith("/setup-plan"))
        return json({ ...plan, baseline: [current] });
      return respond(input);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace/packages/investment-base");
  vi.stubGlobal("crypto", webcrypto);
  URL.createObjectURL = vi.fn(() => "blob:test-archive");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("shows package metadata and authenticated download from a direct URL", async () => {
  installApi();
  render(<App />);
  expect(
    await screen.findByRole("button", { name: "Baixar v1.0.0" }),
  ).toBeTruthy();
  await userEvent.click(screen.getByText("Informações técnicas da versão"));
  const metadata = within(
    screen.getByRole("group", { name: "Versão em exibição" }),
  );
  expect(metadata.getByText("Somente a squad")).toBeTruthy();
  expect(metadata.getByText(digest)).toBeTruthy();
});
it("downloads the selected archive and releases its object URL after activation", async () => {
  const fetcher = installApi();
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Baixar v1.0.0" }),
  );
  await screen.findByText(
    "v1.0.0: SHA-256 conferido. Download enviado ao navegador.",
  );
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  const request = fetcher.mock.calls.find(([input]) =>
    String(input).endsWith("/archive"),
  );
  expect(request?.[1]).toMatchObject({
    cache: "no-store",
    headers: { Authorization: "Bearer token-one" },
  });
  await waitFor(
    () => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test-archive"),
    { timeout: 1500 },
  );
});
it("retains the pinned version and components on direct reload without asking for latest", async () => {
  history.replaceState(
    null,
    "",
    "/workspace/projects/investimentos-api/packages/investment-base/versions/1.0.0",
  );
  const fetcher = installApi(() =>
    json({
      items: [{ ...older, version: "2.0.0" }, current.version],
      next_cursor: null,
    }),
  );
  render(<App />);
  await screen.findByText("Versão fixada no projeto");
  expect(
    screen
      .getByRole("link", { name: "Preparar ambiente" })
      .getAttribute("href"),
  ).toBe("/workspace/projects/investimentos-api#setup");
  expect(screen.getByText("investment-guide")).toBeTruthy();
  expect(
    screen.getByText("Composição da versão 1.0.0, fixada para este projeto."),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.some(
      ([path]) => String(path) === "/v1/plugins/investment-base",
    ),
  ).toBe(false);
  expect(
    screen.getByRole("link", { name: "Voltar ao projeto" }),
  ).toHaveProperty("pathname", "/workspace/projects/investimentos-api");
});
it("does not substitute latest when the pinned version is no longer in the project", async () => {
  history.replaceState(
    null,
    "",
    "/workspace/projects/investimentos-api/packages/investment-base/versions/9.0.0",
  );
  const fetcher = installApi();
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Conteúdo indisponível"),
  );
  expect(
    fetcher.mock.calls.some(
      ([path]) => String(path) === "/v1/plugins/investment-base",
    ),
  ).toBe(false);
});
it("preserves publication order, deduplicates history and downloads an older version without changing the displayed composition", async () => {
  history.replaceState(
    null,
    "",
    "/marketplace/packages/investment-base?limit=1",
  );
  const fetcher = installApi((url) =>
    url.searchParams.has("cursor")
      ? json({ items: [current.version, older], next_cursor: null })
      : json({ items: [current.version], next_cursor: "opaque-history" }),
  );
  render(<App />);
  const more = await screen.findByRole("button", {
    name: "Carregar mais versões",
  });
  more.focus();
  await userEvent.keyboard("{Enter}");
  const historical = await screen.findByRole("button", {
    name: "Baixar versão 9.0.0 do histórico",
  });
  expect(document.activeElement).toBe(historical);
  const rows = within(
    screen.getByRole("region", { name: "Versões publicadas" }),
  ).getAllByRole("heading", { level: 3 });
  expect(rows.map((row) => row.textContent)).toEqual(["v1.0.0", "v9.0.0"]);
  await userEvent.click(historical);
  await screen.findByText(
    "v9.0.0: SHA-256 conferido. Download enviado ao navegador.",
  );
  expect(
    fetcher.mock.calls.some(([path]) =>
      String(path).includes("/9.0.0/archive"),
    ),
  ).toBe(true);
  expect(
    screen.getByText(
      "Composição da versão 1.0.0, a mais recente disponível para sua conta.",
    ),
  ).toBeTruthy();
  expect(screen.getAllByText("investment-guide")).toHaveLength(1);
});
it("keeps history on incremental errors and allows retry", async () => {
  let attempts = 0;
  installApi((url) => {
    if (!url.searchParams.has("cursor"))
      return json({ items: [current.version], next_cursor: "next" });
    attempts++;
    return attempts === 1
      ? json({ code: "unavailable" }, 503)
      : json({ items: [older], next_cursor: null });
  });
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Carregar mais versões" }),
  );
  await screen.findByRole("alert");
  expect(
    screen.getByRole("button", { name: "Baixar versão 1.0.0 do histórico" }),
  ).toBeTruthy();
  await userEvent.click(
    screen.getByRole("button", { name: "Tentar novamente" }),
  );
  expect(
    await screen.findByRole("button", {
      name: "Baixar versão 9.0.0 do histórico",
    }),
  ).toBeTruthy();
});
it.each([404, 500])(
  "does not save a file when access or storage fails after opening the page (%s)",
  async (status) => {
    installApi(undefined, () =>
      json({ code: "archive_error", correlation_id: "download-trace" }, status),
    );
    render(<App />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Baixar v1.0.0" }),
    );
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining(
        status === 404 ? "Arquivo indisponível" : "Não foi possível baixar",
      ),
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  },
);
it("expires the session when download access is revoked with 401", async () => {
  installApi(undefined, () => json({ code: "invalid_token" }, 401));
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Baixar v1.0.0" }),
  );
  expect(await screen.findByRole("textbox", { name: "Email" })).toBeTruthy();
  expect(sessionStorage.length).toBe(0);
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});
it("blocks repeated download clicks and discards late bytes after logout", async () => {
  const pending = deferred<Response>();
  const fetcher = installApi(undefined, () => pending.promise);
  render(<App />);
  const button = await screen.findByRole("button", { name: "Baixar v1.0.0" });
  await userEvent.dblClick(button);
  expect(button.getAttribute("aria-disabled")).toBe("true");
  expect(
    fetcher.mock.calls.filter(([path]) => String(path).endsWith("/archive")),
  ).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await act(async () => pending.resolve(archive()));
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
});
it("distinguishes empty history from an API failure", async () => {
  installApi(() => json({ items: [], next_cursor: null }));
  render(<App />);
  expect(await screen.findByText("Nenhuma versão disponível")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("restarts history after an invalid cursor without duplicating the first version", async () => {
  let firstPages = 0;
  installApi((url) => {
    if (url.searchParams.has("cursor"))
      return json({ code: "invalid_cursor" }, 400);
    firstPages++;
    return json({ items: [current.version], next_cursor: "expired" });
  });
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Carregar mais versões" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Reiniciar histórico" }),
  );
  await screen.findByRole("button", { name: "Carregar mais versões" });
  expect(firstPages).toBe(2);
  expect(
    screen.getAllByRole("button", { name: "Baixar versão 1.0.0 do histórico" }),
  ).toHaveLength(1);
});
it("discards old history and download responses after a different user signs in", async () => {
  const pendingHistory = deferred<Response>();
  const pendingArchive = deferred<Response>();
  let signedInAgain = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/dev-login")) {
        signedInAgain = true;
        return json({
          access_token: "new-user-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (path.endsWith("/archive")) return pendingArchive.promise;
      if (path.includes("/versions?"))
        return signedInAgain
          ? json({ items: [], next_cursor: null })
          : pendingHistory.promise;
      if (path.endsWith("/plugins/investment-base")) {
        if (signedInAgain)
          expect(
            (options?.headers as Record<string, string>).Authorization,
          ).toBe("Bearer new-user-token");
        return signedInAgain ? json({ code: "not_found" }, 404) : json(current);
      }
      return respond(input);
    }),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Baixar v1.0.0" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Email" }),
    "new@example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await screen.findByRole("heading", {
    name: "Seu espaço, suas próximas ideias.",
  });
  await act(async () => {
    history.replaceState(null, "", "/marketplace/packages/investment-base");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await screen.findByRole("alert");
  await act(async () => {
    pendingArchive.resolve(archive());
    pendingHistory.resolve(json({ items: [older], next_cursor: null }));
  });
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(screen.queryByText("v9.0.0")).toBeNull();
  expect(screen.queryByRole("button", { name: "Baixar v1.0.0" })).toBeNull();
  expect(sessionStorage.getItem("smart-harness.access-token")).toBe(
    "new-user-token",
  );
});
it("retries a failed download once and does not save the error response", async () => {
  let attempts = 0;
  installApi(undefined, () =>
    ++attempts === 1 ? json({ code: "storage_failure" }, 500) : archive(),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Baixar v1.0.0" }),
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Tentar download novamente" }),
  );
  await screen.findByText(
    "v1.0.0: SHA-256 conferido. Download enviado ao navegador.",
  );
  expect(attempts).toBe(2);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
});
