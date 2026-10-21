import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { Project } from "../../src/pages/Project";
import { plan, projects, json } from "../../src/test/fixtures";
const expire = vi.fn();
it("shows actual CLI commands with a terminal API URL and never claims local completion", async () => {
  const user = userEvent.setup();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(plan)),
  );
  render(
    <Project
      slug="investimentos-api"
      token="jwt"
      expire={expire}
      projects={projects}
    />,
  );
  expect(
    await screen.findByDisplayValue(
      "harness setup 'investimentos-api' --api-url 'http://127.0.0.1:8080'",
    ),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("harness doctor")).toBeTruthy();
  expect(screen.getByDisplayValue("harness sync")).toBeTruthy();
  expect(screen.getByText("v1.0.0 · fixada")).toBeTruthy();
  await user.click(
    screen.getByRole("button", { name: "Copiar comando de setup" }),
  );
  expect(
    screen.getByText("Copiado para a área de transferência."),
  ).toBeTruthy();
  expect(
    screen.queryByText(/Ambiente preparado|Instalação concluída/),
  ).toBeNull();
  await user.clear(
    screen.getByRole("textbox", { name: "URL da API para a CLI" }),
  );
  await user.type(
    screen.getByRole("textbox", { name: "URL da API para a CLI" }),
    "http://internal-api:8080",
  );
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(
    screen.queryByRole("button", { name: "Copiar comando de setup" }),
  ).toBeNull();
  expect(
    screen.getByRole("link", { name: "Meus tokens" }).getAttribute("target"),
  ).toBe("_blank");
  expect(
    screen
      .getByRole("link", { name: "release v0.1.0 da CLI" })
      .getAttribute("href"),
  ).toBe(
    "https://github.com/nelsonfrugeri-tech/smart-harness/releases/tag/v0.1.0",
  );
});
it("continues optionals using the setup-plan cursor and drops old instructions on a failed project switch", async () => {
  const fetcher = vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes("marketplace?")
      ? json({ items: [], next_cursor: null })
      : String(input).includes("conta-digital")
        ? json({ code: "not_found" }, 404)
        : json({
            ...plan,
            optional: { items: plan.baseline, next_cursor: "next+opaque" },
          }),
  );
  vi.stubGlobal("fetch", fetcher);
  const view = render(
    <Project
      slug="investimentos-api"
      token="jwt"
      expire={expire}
      projects={projects}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Próxima página de complementos",
    }),
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(
        ([url]) =>
          String(url) ===
          "/v1/marketplace?project=investimentos-api&cursor=next%2Bopaque&limit=20",
      ),
    ).toBe(true),
  );
  expect(
    await screen.findByText("Nenhum complemento nesta página."),
  ).toBeTruthy();
  view.rerender(
    <Project
      slug="conta-digital"
      token="jwt"
      expire={expire}
      projects={projects}
    />,
  );
  expect(
    screen.queryByDisplayValue(
      "harness setup 'investimentos-api' --api-url 'http://127.0.0.1:8080'",
    ),
  ).toBeNull();
  expect(await screen.findByText("Conteúdo indisponível")).toBeTruthy();
});
