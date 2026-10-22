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
    screen.getByRole("link", { name: "Meus tokens" }).getAttribute("href"),
  ).toBe("/profile/tokens?project=investimentos-api");
  expect(
    screen.getByRole("link", { name: "releases da CLI" }).getAttribute("href"),
  ).toBe("https://github.com/nelsonfrugeri-tech/smart-harness/releases/latest");
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

const demoProject = { ...projects[0], slug: "md2poui", name: "TOTVS md2poui" };
it("prepares the TOTVS checkout and opens only agents present in the actual plan", async () => {
  const demoPlan = {
    ...plan,
    project: demoProject,
    optional: {
      items: ["graphify", "deja-vu"].map((name) => ({
        ...plan.baseline[0],
        plugin: { ...plan.baseline[0].plugin, name },
      })),
      next_cursor: null,
    },
    baseline: [
      {
        ...plan.baseline[0],
        plugin: { ...plan.baseline[0].plugin, name: "md2poui-base" },
        components: [
          {
            kind: "agent",
            name: "developer",
            description: "Development",
          },
        ],
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(demoPlan)),
  );
  render(
    <Project
      slug="md2poui"
      token="jwt"
      expire={expire}
      projects={[demoProject]}
    />,
  );
  expect(
    await screen.findByDisplayValue(
      "harness setup 'md2poui' --api-url 'http://127.0.0.1:8080' --include-optional graphify,deja-vu",
    ),
  ).toBeTruthy();
  expect(
    screen.getByDisplayValue(/git clone --branch demo-start/),
  ).toBeTruthy();
  expect(
    screen.getByDisplayValue("claude --agent 'md2poui-base:developer'"),
  ).toBeTruthy();
  expect(screen.queryByDisplayValue(/claude --agent.*review/)).toBeNull();
  expect(
    screen.getByText(/O agente de review ainda não está no plano/),
  ).toBeTruthy();
  expect(screen.getByDisplayValue("harness tools check")).toBeTruthy();
  const commandFields = screen
    .getAllByRole("textbox")
    .filter((field) => field instanceof HTMLTextAreaElement);
  const commandValues = commandFields.map(
    (field) => (field as HTMLTextAreaElement).value,
  );
  const installIndex = commandValues.findIndex((value) =>
    value.startsWith("harness tools install"),
  );
  const checkIndex = commandValues.indexOf("harness tools check");
  const setupIndex = commandValues.findIndex((value) =>
    value.startsWith("harness setup"),
  );
  const doctorIndex = commandValues.indexOf("harness doctor");
  const agentIndex = commandValues.findIndex((value) =>
    value.startsWith("claude --agent"),
  );
  expect(installIndex).toBeLessThan(checkIndex);
  expect(checkIndex).toBeLessThan(setupIndex);
  expect(setupIndex).toBeLessThan(doctorIndex);
  expect(doctorIndex).toBeLessThan(agentIndex);
  expect(
    screen.queryByText(/Instalação concluída|Conectores conectados/),
  ).toBeNull();
});
it("does not show the TOTVS checkout or local tool commands for another project", async () => {
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
  await screen.findByDisplayValue("harness doctor");
  expect(
    screen.queryByDisplayValue(/git clone --branch demo-start/),
  ).toBeNull();
  expect(screen.queryByDisplayValue("harness tools check")).toBeNull();
});
