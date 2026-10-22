import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/app/App";
beforeEach(() => {
  history.replaceState(null, "", "/workspace");
});
it("requires local login before showing any project", () => {
  render(<App />);
  expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
  expect(screen.queryByText("Investimentos")).toBeNull();
});
it("keeps an unknown user on the form with a useful error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            code: "unknown_user",
            correlation_id: "test-unknown",
          }),
          { status: 401 },
        ),
    ),
  );
  render(<App />);
  const user = userEvent.setup();
  await user.type(
    screen.getByRole("textbox", { name: "Email" }),
    "unknown@example.com",
  );
  await user.click(screen.getByRole("button", { name: "Entrar" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("Email não cadastrado"),
  );
  expect(sessionStorage.length).toBe(0);
});

import { act, waitFor } from "@testing-library/react";
import {
  json,
  me,
  plan,
  projects,
  respond,
  deferred,
} from "../../src/test/fixtures";
function authenticated(path = "/workspace") {
  sessionStorage.setItem("smart-harness.access-token", "token-one");
  history.replaceState(null, "", path);
}
it("shows only API projects and the pinned composition on a direct URL", async () => {
  authenticated("/workspace/projects/investimentos-api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => respond(input)),
  );
  render(<App />);
  expect(await screen.findByText("investment-guide")).toBeTruthy();
  expect(screen.getByText("v1.0.0 · fixada")).toBeTruthy();
  expect(screen.queryByText("Cartões")).toBeNull();
  expect(screen.queryByRole("button", { name: "Visão dev" })).toBeNull();
});
it("distinguishes an empty workspace from a failed request and offers one retry", async () => {
  authenticated();
  let attempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/me")) {
        attempts++;
        return attempts === 1
          ? json({ code: "unavailable", correlation_id: "trace-one" }, 503)
          : json(me);
      }
      return respond(input);
    }),
  );
  render(<App />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    expect.stringContaining("trace-one"),
  );
  expect(screen.queryByText("Seu workspace está vazio")).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Tentar novamente" }),
  );
  expect(await screen.findByText("Seu workspace está vazio")).toBeTruthy();
  expect(attempts).toBe(2);
});
it.each([403, 404])(
  "shows the same unavailable result for project status %s",
  async (status) => {
    authenticated("/workspace/projects/hidden");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes("/setup-plan")
          ? json({ code: "not_found" }, status)
          : respond(input),
      ),
    );
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining(
        "Este conteúdo não está disponível para sua conta.",
      ),
    );
    expect(screen.queryByText("investment-guide")).toBeNull();
  },
);
it("clears an expired session without showing cached identity", async () => {
  authenticated("/workspace/projects/investimentos-api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code: "expired_token" }, 401)),
  );
  render(<App />);
  expect(await screen.findByRole("textbox", { name: "Email" })).toBeTruthy();
  expect(screen.getByText("Sua sessão expirou. Entre novamente.")).toBeTruthy();
  expect(location.pathname).toBe("/workspace");
  expect(sessionStorage.length).toBe(0);
  expect(screen.queryByText(me.user.name)).toBeNull();
});
it("does not restore the previous user's data from an outstanding request after logout", async () => {
  authenticated("/workspace/projects/investimentos-api");
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/setup-plan") ? pending.promise : respond(input),
    ),
  );
  render(<App />);
  await screen.findByText("Carregando composição do projeto…");
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await act(async () => pending.resolve(json(plan)));
  expect(screen.queryByText("investment-guide")).toBeNull();
  expect(screen.getByRole("textbox", { name: "Email" })).toBeTruthy();
  expect(location.pathname).toBe("/workspace");
  expect(sessionStorage.length).toBe(0);
});
it("ignores an old project's late response and handles browser navigation", async () => {
  authenticated("/workspace/projects/investimentos-api");
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("/investimentos-api/setup-plan")
        ? pending.promise
        : respond(input),
    ),
  );
  render(<App />);
  await screen.findByRole("combobox", { name: "Projeto" });
  await userEvent.selectOptions(
    screen.getByRole("combobox", { name: "Projeto" }),
    "conta-digital",
  );
  expect(
    await screen.findByText("Pacote base ainda não definido"),
  ).toBeTruthy();
  await act(async () => pending.resolve(json(plan)));
  expect(screen.queryByText("investment-guide")).toBeNull();
  expect(screen.getByRole("heading", { name: "Conta" })).toBeTruthy();
  await act(async () => {
    history.replaceState(null, "", "/workspace");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(
    screen.getByRole("heading", { name: "Seu espaço, suas próximas ideias." }),
  ).toBeTruthy();
});
it("loads only the new account's identity after signing in", async () => {
  authenticated();
  let second = false;
  const cart = { ...projects[0], slug: "cartoes-app", name: "Cartões" };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/dev-login")) {
        second = true;
        return json({
          access_token: "token-two",
          token_type: "Bearer",
          expires_in: 3600,
        });
      }
      if (second && path.endsWith("/me"))
        return json({
          user: { ...me.user, id: "dev-two", name: "Development Two" },
          memberships: [],
        });
      if (second && path.endsWith("/workspace")) {
        expect((init?.headers as Record<string, string>).Authorization).toBe(
          "Bearer token-two",
        );
        return json({ user: { ...me.user, id: "dev-two" }, projects: [cart] });
      }
      return respond(input);
    }),
  );
  render(<App />);
  await screen.findByText("Development One");
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Email" }),
    "dev.two@example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  expect(await screen.findByText("Development Two")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Investimentos" })).toBeNull();
  expect(screen.queryByText("Development One")).toBeNull();
});
it("keeps login uncommitted when identity confirmation fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/me")
        ? json({ code: "expired_token" }, 401)
        : respond(input),
    ),
  );
  render(<App />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Email" }),
    "dev@example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain(
      "Não foi possível confirmar",
    ),
  );
  expect(sessionStorage.length).toBe(0);
});
it("does not let a previous identity's delayed 401 clear a new session", async () => {
  authenticated("/workspace/projects/investimentos-api");
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes("/setup-plan")) return pending.promise;
      if (String(input).endsWith("/dev-login"))
        return json({
          access_token: "new-token",
          token_type: "Bearer",
          expires_in: 3600,
        });
      return respond(input);
    }),
  );
  render(<App />);
  await screen.findByText("Carregando composição do projeto…");
  await userEvent.click(screen.getByRole("button", { name: "Sair" }));
  await userEvent.type(
    screen.getByRole("textbox", { name: "Email" }),
    "new@example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await screen.findByRole("heading", {
    name: "Seu espaço, suas próximas ideias.",
  });
  await act(async () => pending.resolve(json({ code: "expired_token" }, 401)));
  expect(
    screen.getByRole("heading", { name: "Seu espaço, suas próximas ideias." }),
  ).toBeTruthy();
  expect(sessionStorage.getItem("smart-harness.access-token")).toBe(
    "new-token",
  );
});
it.each([400, 404])(
  "keeps local login errors recoverable for status %s",
  async (status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ code: "validation_failed" }, status)),
    );
    render(<App />);
    await userEvent.type(
      screen.getByRole("textbox", { name: "Email" }),
      "dev@example.com",
    );
    await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining(
        status === 400 ? "Confira o email" : "login local não está habilitado",
      ),
    );
    expect(
      (screen.getByRole("button", { name: "Entrar" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  },
);
it("shows the empty workspace for an account without memberships", async () => {
  authenticated();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/me")
        ? json({ ...me, memberships: [] })
        : json({ user: me.user, projects: [] }),
    ),
  );
  render(<App />);
  expect(await screen.findByText("Seu workspace está vazio")).toBeTruthy();
  expect(screen.queryByText("Seus acessos")).toBeNull();
  expect(screen.queryByRole("heading", { name: "Investimentos" })).toBeNull();
});
it("preserves the project selector node and keyboard focus while changing projects", async () => {
  authenticated("/workspace/projects/investimentos-api");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => respond(input)),
  );
  render(<App />);
  await screen.findByText("investment-guide");
  const selector = screen.getByRole("combobox", { name: "Projeto" });
  selector.focus();
  await userEvent.selectOptions(selector, "conta-digital");
  expect(selector.isConnected).toBe(true);
  expect(document.activeElement).toBe(selector);
  expect(
    await screen.findByText("Pacote base ainda não definido"),
  ).toBeTruthy();
  expect(document.activeElement).toBe(selector);
});
it("reuses the confirmed login identity and fetches it again on reload", async () => {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/me")) calls++;
      return respond(input);
    }),
  );
  const view = render(<App />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Email" }),
    "dev@example.com",
  );
  await userEvent.click(screen.getByRole("button", { name: "Entrar" }));
  await screen.findByRole("heading", {
    name: "Seu espaço, suas próximas ideias.",
  });
  expect(calls).toBe(1);
  view.unmount();
  render(<App />);
  await screen.findByRole("heading", {
    name: "Seu espaço, suas próximas ideias.",
  });
  expect(calls).toBe(2);
});

it("returns from token creation to the personal CLI guide without the secret", async () => {
  authenticated("/cli");
  const secret = "shg_" + "s".repeat(43);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("gateway-tokens")) {
        return init?.method === "POST"
          ? json(
              {
                id: "token-demo",
                name: "Laptop",
                token: secret,
                created_at: "2026-10-01T12:00:00Z",
                expires_at: "2027-10-01T12:00:00Z",
                revoked_at: null,
              },
              201,
            )
          : json({ items: [], next_cursor: null });
      }
      return respond(input);
    }),
  );
  render(<App />);
  await userEvent.click(
    await screen.findByRole("link", { name: "Ir para meus tokens" }),
  );
  expect(location.pathname).toBe("/profile");
  await screen.findByRole("heading", { name: "Meus tokens" });
  await userEvent.type(
    screen.getByRole("textbox", { name: "Nome do token" }),
    "Laptop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Criar token" }));
  expect(await screen.findByDisplayValue(secret)).toBeTruthy();
  await userEvent.click(
    screen.getByRole("link", { name: "Preparar minha CLI" }),
  );
  expect(location.pathname).toBe("/cli");
  await screen.findByRole("heading", { name: "Do seu perfil ao terminal." });
  expect(screen.queryByDisplayValue(secret)).toBeNull();
  expect(screen.getByDisplayValue("harness doctor")).toBeTruthy();
});

it("does not turn an unknown token project query into a return link", async () => {
  authenticated("/profile/tokens?project=unavailable");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("gateway-tokens")
        ? json({ items: [], next_cursor: null })
        : respond(input),
    ),
  );
  render(<App />);
  await screen.findByText("Nenhum token nesta página");
  expect(
    screen.queryByRole("link", { name: /Voltar à preparação/ }),
  ).toBeNull();
});
