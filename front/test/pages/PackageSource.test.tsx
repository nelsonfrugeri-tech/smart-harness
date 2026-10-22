import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { App } from "../../src/app/App";
import { json, plan, respond } from "../../src/test/fixtures";
const base = plan.baseline[0];
const metadata = {
  source: {
    kind: "internal",
    repository_url: "https://github.com/example/catalog",
  },
  related_project: {
    name: "Related tool",
    kind: "open-source",
    repository_url: "https://github.com/example/tool",
    license: "MIT",
  },
};
function mockPackage(extra: object = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/v1/plugins/investment-base")
        return json({ ...base, ...extra });
      if (path.startsWith("/v1/marketplace"))
        return json({ items: [{ ...base, ...extra }], next_cursor: null });
      if (path.endsWith("/versions?limit=20"))
        return json({ items: [base.version], next_cursor: null });
      return respond(input);
    }),
  );
}
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/marketplace/packages/investment-base");
});
it("distinguishes the internal package from its open-source related project", async () => {
  mockPackage(metadata);
  render(<App />);
  const source = await screen.findByRole("region", {
    name: "Origem do pacote",
  });
  expect(within(source).getByText("Interno")).toBeTruthy();
  const related = screen.getByRole("region", { name: "Projeto relacionado" });
  expect(within(related).getByText("Open source")).toBeTruthy();
  expect(within(related).getByText("MIT")).toBeTruthy();
  const link = within(related).getByRole("link", {
    name: /Ver Related tool no GitHub/,
  });
  expect(link.getAttribute("href")).toBe("https://github.com/example/tool");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toContain("noopener");
});
it("leaves legacy packages without an invented source or empty source section", async () => {
  mockPackage();
  render(<App />);
  await screen.findByRole("heading", { name: "Componentes do pacote" });
  expect(screen.queryByRole("region", { name: "Origem do pacote" })).toBeNull();
  expect(
    screen.queryByRole("region", { name: "Projeto relacionado" }),
  ).toBeNull();
  expect(screen.queryByText("Interno")).toBeNull();
  expect(screen.queryByText("Open source")).toBeNull();
});
it.each([
  "javascript:alert(1)",
  "https://github.com.evil.example/owner/repo",
  "https://user:secret@github.com/owner/repo",
  "https://github.com/owner/repo?token=secret",
  "https://github.com/owner/repo#secret",
])("does not render an unsafe repository link: %s", async (repository_url) => {
  mockPackage({ source: { kind: "internal", repository_url } });
  render(<App />);
  await screen.findByRole("heading", { name: "Componentes do pacote" });
  expect(screen.queryByRole("link", { name: /GitHub/ })).toBeNull();
});
it("uses package origin on cards without promoting a related project's license", async () => {
  history.replaceState(null, "", "/marketplace");
  mockPackage(metadata);
  render(<App />);
  await screen.findByRole("heading", { name: "investment-base" });
  expect(screen.getByText("Interno")).toBeTruthy();
  expect(screen.queryByText("Open source")).toBeNull();
});
