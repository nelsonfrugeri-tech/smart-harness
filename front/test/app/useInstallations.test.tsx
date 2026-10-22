import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { App } from "../../src/app/App";
import { json, plan, respond } from "../../src/test/fixtures";
const first = plan.baseline[0];
const second = { ...first, plugin: { ...first.plugin, name: "review-tools" } };
// Shape of GET /v1/me/installations as agreed with the control-plane.
const installed = () =>
  json({
    cliVersion: "0.2.3",
    reportedAt: "2026-10-22T12:00:00Z",
    plugins: [
      {
        name: "investment-base",
        version: "1.0.0",
        installedAt: "2026-10-22T11:00:00Z",
      },
    ],
  });
function mockApi(installations: () => Response) {
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/v1/marketplace")
        return json({ items: [first, second], next_cursor: null });
      if (url.pathname === "/v1/plugins/investment-base") return json(first);
      if (url.pathname.endsWith("/versions"))
        return json({ items: [first.version], next_cursor: null });
      if (url.pathname === "/v1/me/installations") return installations();
      return respond(input);
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace");
});
it("marks only reported packages and loads installations once per visit", async () => {
  const fetcher = mockApi(installed);
  render(<App />);
  const card = (
    await screen.findByRole("heading", { name: "investment-base" })
  ).closest("article");
  expect(await within(card!).findByText("Instalado")).toBeTruthy();
  const other = screen
    .getByRole("heading", { name: "review-tools" })
    .closest("article");
  expect(within(other!).queryByText("Instalado")).toBeNull();
  const requests = fetcher.mock.calls.filter(([input]) =>
    String(input).endsWith("/v1/me/installations"),
  );
  expect(requests).toHaveLength(1);
  expect(requests[0][1]).toMatchObject({
    headers: { Authorization: "Bearer token-one" },
  });
});
it("keeps the marketplace usable while installations are not deployed", async () => {
  mockApi(() => json({ code: "not_found", correlation_id: "no-route" }, 404));
  render(<App />);
  await screen.findByRole("heading", { name: "investment-base" });
  expect(screen.getByRole("heading", { name: "review-tools" })).toBeTruthy();
  expect(screen.getByText("2 pacotes carregados")).toBeTruthy();
  expect(screen.queryByText("Instalado")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("no-route")).toBeNull();
});
it("shows the installed marker next to the package actions", async () => {
  history.replaceState(null, "", "/marketplace/packages/investment-base");
  mockApi(installed);
  render(<App />);
  await screen.findByRole("button", { name: "Baixar v1.0.0" });
  expect(await screen.findByText("Instalado")).toBeTruthy();
});
