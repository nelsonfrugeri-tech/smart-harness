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
it("copies one installer command after the token step without claiming completion", async () => {
  history.replaceState(null, "", "/cli");
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  render(<App />);
  await screen.findByRole("heading", { name: "Do seu perfil ao terminal." });
  const command = "curl -fsSL 'http://127.0.0.1:8080/install' | sh";
  const token = screen.getByRole("link", { name: "Ir para meus tokens" });
  const install = screen.getByRole("button", {
    name: "Copiar instalar e configurar",
  });
  expect(
    token.compareDocumentPosition(install) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.getByDisplayValue(command)).toBeTruthy();
  await user.click(install);
  expect(copy).toHaveBeenCalledWith(command);
  expect(
    screen.getByText("Copiado para a área de transferência."),
  ).toBeTruthy();
  expect(
    screen.queryByText(/Ambiente conectado|Instalação concluída/),
  ).toBeNull();
  const prerequisites = screen
    .getByText("Antes de começar: pré-requisitos")
    .closest("details");
  expect(prerequisites?.open).toBe(false);
  await user.click(screen.getByText("Antes de começar: pré-requisitos"));
  expect(prerequisites?.open).toBe(true);
  expect(screen.getByText(/Instalação parcial/)).toBeTruthy();
  expect(
    screen.getByDisplayValue("claude --model openrouter/free"),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("/code-review:code-review")).toBeTruthy();
  expect(screen.queryByDisplayValue(/--agent/)).toBeNull();
  expect(screen.queryByRole("link", { name: "software-delivery" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Baixar CLI" })).toBeNull();
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
it("hides the installer for unsafe origins and recovers with the corrected command", async () => {
  history.replaceState(null, "", "/cli");
  render(<App />);
  const field = await screen.findByRole("textbox", {
    name: "URL da plataforma",
  });
  const user = userEvent.setup();
  for (const origin of [
    "https://user:secret@example.com",
    "http://external.example.com",
  ]) {
    await user.clear(field);
    await user.type(field, origin);
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copiar instalar e configurar" }),
    ).toBeNull();
  }
  await user.clear(field);
  await user.type(field, "https://harness.example.com");
  expect(
    screen.getByDisplayValue(
      "curl -fsSL 'https://harness.example.com/install' | sh",
    ),
  ).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  const commands = [
    /^curl -fsSL /,
    /^harness doctor$/,
    /^harness tools run graphify update /,
    /^claude --model openrouter\/free$/,
  ].map((command) => screen.getByDisplayValue(command));
  for (let index = 1; index < commands.length; index++) {
    expect(
      commands[index - 1].compareDocumentPosition(commands[index]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  }
});
