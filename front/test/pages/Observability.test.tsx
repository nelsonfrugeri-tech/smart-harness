import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App";
import { respond } from "../../src/test/fixtures";
// The viewer address is the contract with the CLI; the test states it
// independently so a drift in the constant is caught here.
const VIEWER_URL = "http://127.0.0.1:8787";
function stubViewer(outcomes: ("online" | "offline")[]) {
  let probes = 0;
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, _init?: RequestInit) => {
      void _init;
      if (!String(input).startsWith(VIEWER_URL)) return respond(input);
      const outcome = outcomes[Math.min(probes++, outcomes.length - 1)];
      if (outcome === "offline") throw new TypeError("Failed to fetch");
      return new Response(null, { status: 200 });
    },
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", "/observability");
});
it("shows the empty state with the start command when the local viewer is unreachable", async () => {
  stubViewer(["offline"]);
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Visualizador não encontrado" }),
  ).toBeTruthy();
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.getByDisplayValue("harness vendor=claude")).toBeTruthy();
  expect(screen.getByText(/só você vê/)).toBeTruthy();
  const open = screen.getByRole("link", { name: "Abrir em nova aba" });
  expect(open.getAttribute("href")).toBe(VIEWER_URL);
  expect(open.getAttribute("target")).toBe("_blank");
});
it("embeds the local viewer when the no-cors probe resolves", async () => {
  const fetcher = stubViewer(["online"]);
  render(<App />);
  const frame = await screen.findByTitle(
    "Visualizador de traces do claude-tap",
  );
  expect(frame.tagName).toBe("IFRAME");
  expect(frame.getAttribute("src")).toBe(VIEWER_URL);
  const probe = fetcher.mock.calls.find(([input]) =>
    String(input).startsWith(VIEWER_URL),
  );
  expect(probe?.[1]).toMatchObject({ mode: "no-cors" });
  expect(screen.getByRole("link", { name: "Abrir em nova aba" })).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Visualizador não encontrado" }),
  ).toBeNull();
});
it("re-checks the viewer on demand after an offline result", async () => {
  const fetcher = stubViewer(["offline", "online"]);
  render(<App />);
  await screen.findByRole("heading", { name: "Visualizador não encontrado" });
  await userEvent.click(
    screen.getByRole("button", { name: "Verificar novamente" }),
  );
  expect(
    await screen.findByTitle("Visualizador de traces do claude-tap"),
  ).toBeTruthy();
  expect(
    fetcher.mock.calls.filter(([input]) =>
      String(input).startsWith(VIEWER_URL),
    ),
  ).toHaveLength(2);
});
it("reaches the page from the main navigation", async () => {
  history.replaceState(null, "", "/workspace");
  stubViewer(["offline"]);
  render(<App />);
  const navigation = await screen.findByRole("navigation", {
    name: "Navegação principal",
  });
  const link = within(navigation).getByRole("link", {
    name: "Observabilidade",
  });
  expect(link.getAttribute("aria-current")).toBeNull();
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { name: "Traces do Claude Code" }),
  ).toBeTruthy();
  expect(location.pathname).toBe("/observability");
  expect(link.getAttribute("aria-current")).toBe("page");
});
