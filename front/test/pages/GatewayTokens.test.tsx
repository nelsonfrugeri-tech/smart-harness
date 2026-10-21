import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { GatewayTokens } from "../../src/pages/GatewayTokens";
import { json, deferred } from "../../src/test/fixtures";
const token = {
  id: "token-1",
  name: "Developer laptop",
  created_at: "2026-10-01T12:00:00Z",
  expires_at: "2027-10-01T12:00:00Z",
  revoked_at: null,
};
const secret = "shg_" + "s".repeat(43);
const expire = vi.fn();
beforeEach(() => {
  expire.mockClear();
});
it("creates a secret once, copies truthfully, and removes it on close and unmount", async () => {
  const user = userEvent.setup();
  const write = vi
    .spyOn(navigator.clipboard, "writeText")
    .mockRejectedValue(new Error("denied"));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: RequestInfo | URL, options?: RequestInit) =>
      options?.method === "POST"
        ? json({ ...token, token: secret }, 201)
        : json({ items: [token], next_cursor: null }),
    ),
  );
  const view = render(<GatewayTokens token="jwt" expire={expire} />);
  await screen.findByText(token.name);
  await user.type(
    screen.getByRole("textbox", { name: "Nome do token" }),
    "Laptop",
  );
  await user.click(screen.getByRole("button", { name: "Criar token" }));
  expect(await screen.findByRole("textbox", { name: "Token" })).toHaveProperty(
    "value",
    secret,
  );
  await user.click(screen.getByRole("button", { name: "Copiar token" }));
  expect(screen.getByText(/Não foi possível copiar/)).toBeTruthy();
  expect(document.activeElement).toBe(
    screen.getByRole("textbox", { name: "Token" }),
  );
  expect(sessionStorage.length).toBe(0);
  expect(localStorage.length).toBe(0);
  write.mockResolvedValue();
  await user.click(screen.getByRole("button", { name: "Copiar token" }));
  expect(
    screen.getByText("Copiado para a área de transferência."),
  ).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "Fechar segredo" }));
  expect(screen.queryByDisplayValue(secret)).toBeNull();
  view.unmount();
  render(<GatewayTokens token="other-jwt" expire={expire} />);
  expect(screen.queryByDisplayValue(secret)).toBeNull();
});
it("confirms the selected id and retains the item after a failed revocation", async () => {
  const user = userEvent.setup();
  let revoked = false;
  const fetcher = vi.fn(async (_: RequestInfo | URL, options?: RequestInit) =>
    options?.method === "DELETE"
      ? revoked
        ? new Response(null, { status: 204 })
        : json({ code: "unavailable" }, 503)
      : json({
          items: [{ ...token, revoked_at: revoked ? token.created_at : null }],
          next_cursor: null,
        }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<GatewayTokens token="jwt" expire={expire} />);
  await user.click(
    await screen.findByRole("button", { name: "Revogar Developer laptop" }),
  );
  expect(
    fetcher.mock.calls.every(([, options]) => options?.method !== "DELETE"),
  ).toBe(true);
  await user.click(screen.getByRole("button", { name: "Confirmar revogação" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("heading", { name: token.name })).toBeTruthy();
  revoked = true;
  await user.click(screen.getByRole("button", { name: "Confirmar revogação" }));
  expect(
    await screen.findByText(/Token “Developer laptop” revogado/),
  ).toBeTruthy();
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Revogar Developer laptop" }),
    ).toBeNull(),
  );
  expect(
    fetcher.mock.calls.find(([, options]) => options?.method === "DELETE")?.[0],
  ).toBe("/v1/me/gateway-tokens/token-1");
});
it("paginates with an opaque cursor and expires the session on 401", async () => {
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    String(url).includes("cursor=")
      ? json({ code: "unauthorized" }, 401)
      : json({ items: [], next_cursor: "opaque+cursor" }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<GatewayTokens token="jwt" expire={expire} />);
  expect(await screen.findByText("Nenhum token nesta página")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Próxima página" }));
  await waitFor(() => expect(expire).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls.at(-1)?.[0]).toBe(
    "/v1/me/gateway-tokens?limit=20&cursor=opaque%2Bcursor",
  );
});
it("discards a late secret after leaving the screen", async () => {
  const pending = deferred<Response>();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_: RequestInfo | URL, options?: RequestInit) =>
      options?.method === "POST"
        ? pending.promise
        : json({ items: [], next_cursor: null }),
    ),
  );
  const view = render(<GatewayTokens token="jwt" expire={expire} />);
  await userEvent.type(
    screen.getByRole("textbox", { name: "Nome do token" }),
    "Laptop",
  );
  await userEvent.click(screen.getByRole("button", { name: "Criar token" }));
  view.unmount();
  await act(async () =>
    pending.resolve(json({ ...token, token: secret }, 201)),
  );
  expect(screen.queryByDisplayValue(secret)).toBeNull();
});

it("restores focus to the revocation trigger after cancelling confirmation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ items: [token], next_cursor: null })),
  );
  render(<GatewayTokens token="jwt" expire={expire} />);
  const trigger = await screen.findByRole("button", {
    name: "Revogar Developer laptop",
  });
  await userEvent.click(trigger);
  expect(document.activeElement).toBe(
    screen.getByRole("heading", { name: "Revogar “Developer laptop”?" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(document.activeElement).toBe(trigger);
});
