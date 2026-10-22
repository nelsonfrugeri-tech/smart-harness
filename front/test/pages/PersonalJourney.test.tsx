import { beforeEach, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App";
import { json, me, respond } from "../../src/test/fixtures";
beforeEach(() => {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/gateway-tokens")
        ? json({ items: [], next_cursor: null })
        : respond(input),
    ),
  );
});
it("keeps the personal workspace empty without requesting seeded projects", async () => {
  history.replaceState(null, "", "/workspace");
  render(<App />);
  expect(
    await screen.findByRole("heading", {
      name: "Seu espaço, suas próximas ideias.",
    }),
  ).toBeTruthy();
  expect(screen.queryByText("Investimentos")).toBeNull();
  expect(
    screen.queryByRole("link", { name: "Preparar demo TOTVS" }),
  ).toBeNull();
  expect(
    vi
      .mocked(fetch)
      .mock.calls.some(([input]) => String(input).endsWith("/workspace")),
  ).toBe(false);
});
it("opens a real profile with tokens and no invented job title", async () => {
  history.replaceState(null, "", "/profile");
  render(<App />);
  expect(
    await screen.findByRole("heading", { name: "Meu perfil" }),
  ).toBeTruthy();
  expect(screen.getByText(me.user.email, { selector: "dd" })).toBeTruthy();
  expect(screen.getByText("Não informado")).toBeTruthy();
  expect(
    await screen.findByRole("heading", { name: "Meus tokens" }),
  ).toBeTruthy();
  const navigation = screen.getByRole("navigation", {
    name: "Navegação principal",
  });
  expect(
    within(navigation).queryByRole("link", { name: "Meus tokens" }),
  ).toBeNull();
  expect(within(navigation).getByRole("link", { name: "CLI" })).toBeTruthy();
});
it("offers a nonblocking CLI journey with platform selection and no completion claim", async () => {
  history.replaceState(null, "", "/cli");
  render(<App />);
  await screen.findByRole("heading", { name: "Do seu perfil ao terminal." });
  expect(screen.getByRole("link", { name: "Já tenho a CLI" })).toBeTruthy();
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Sistema operacional" }),
    "linux",
  );
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Arquitetura" }),
    "amd64",
  );
  expect(
    screen.getByRole("link", { name: "Baixar CLI" }).getAttribute("href"),
  ).toBe(
    "https://github.com/nelsonfrugeri-tech/smart-harness/releases/download/v0.2.0/harness-v0.2.0-linux-amd64",
  );
  expect(
    screen.queryByText(/Ambiente conectado|Instalação concluída/),
  ).toBeNull();
  expect(
    screen.getByDisplayValue(
      "harness install github trello notion graphify deja-vu md2poui code-review",
    ),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("claude")).toBeTruthy();
  expect(screen.getByDisplayValue("/code-review:code-review")).toBeTruthy();
  expect(screen.queryByDisplayValue(/--agent/)).toBeNull();
  expect(screen.queryByRole("link", { name: "software-delivery" })).toBeNull();
});

it("uses the actual job title when the API supplies it", async () => {
  history.replaceState(null, "", "/profile");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/me")
        ? json({ ...me, user: { ...me.user, job_title: "Software Engineer" } })
        : json({ items: [], next_cursor: null }),
    ),
  );
  render(<App />);
  expect(await screen.findByText("Software Engineer")).toBeTruthy();
  expect(screen.queryByText("Não informado")).toBeNull();
});
it("does not offer a login command for unsafe API URLs and recovers after correction", async () => {
  history.replaceState(null, "", "/cli");
  render(<App />);
  const field = await screen.findByRole("textbox", {
    name: "URL da plataforma",
  });
  const user = userEvent.setup();
  await user.clear(field);
  await user.type(field, "https://user:secret@example.com");
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Copiar conectar cli" }),
  ).toBeNull();
  await user.clear(field);
  await user.type(field, "https://harness.example.com");
  expect(
    screen.getByDisplayValue(
      "harness login --api-url 'https://harness.example.com'",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const tools = screen.getByDisplayValue(/harness tools install graphify/);
  const install = screen.getByDisplayValue(/^harness install /);
  expect(
    tools.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});
