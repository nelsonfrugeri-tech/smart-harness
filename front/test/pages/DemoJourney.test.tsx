import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { App } from "../../src/app/App";
import {
  deferred,
  json,
  me,
  plan,
  projects,
  respond,
} from "../../src/test/fixtures";
const demoProject = { ...projects[0], slug: "md2poui", name: "TOTVS md2poui" };
it("opens the available TOTVS setup from the workspace by keyboard and exposes API failure", async () => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/workspace");
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/workspace"))
        return json({ user: me.user, projects: [demoProject] });
      if (path.endsWith("/md2poui/setup-plan")) return pending.promise;
      return respond(input);
    }),
  );
  render(<App />);
  const link = await screen.findByRole("link", { name: "Preparar demo TOTVS" });
  link.focus();
  await userEvent.keyboard("{Enter}");
  expect(location.pathname).toBe("/workspace/projects/md2poui");
  expect(location.hash).toBe("#setup");
  expect(screen.getByText("Carregando composição do projeto…")).toBeTruthy();
  expect(screen.queryByDisplayValue(/harness setup/)).toBeNull();
  await act(async () => pending.resolve(json({ code: "unavailable" }, 503)));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByDisplayValue(/harness setup/)).toBeNull();
});
it("does not offer the demo when the workspace does not authorize its project", async () => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/workspace");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => respond(input)),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "Investimentos" });
  expect(
    screen.queryByRole("link", { name: "Preparar demo TOTVS" }),
  ).toBeNull();
});
it("offers the demo setup from the catalog without changing available package data", async () => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path.endsWith("/workspace"))
        return json({ user: me.user, projects: [demoProject] });
      if (path.startsWith("/v1/marketplace"))
        return json({ items: plan.baseline, next_cursor: null });
      return respond(input);
    }),
  );
  render(<App />);
  await screen.findByRole("heading", { name: "investment-base" });
  expect(
    screen
      .getByRole("link", { name: "Preparar demo TOTVS" })
      .getAttribute("href"),
  ).toBe("/workspace/projects/md2poui#setup");
  expect(
    screen.getByRole("heading", { name: "Conectores e Skills" }),
  ).toBeTruthy();
});
