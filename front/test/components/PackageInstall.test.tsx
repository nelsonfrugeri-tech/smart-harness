import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PackageInstall } from "../../src/components/PackageInstall";
import { plan } from "../../src/test/fixtures";
import type { PluginItem } from "../../src/api/client";
it.each([
  ["connector", "tools"],
  ["skill", "skills"],
  ["agent", "agents"],
] as const)("shows the %s install command", (type, group) => {
  const item: PluginItem = { ...plan.baseline[0], type };
  render(<PackageInstall item={item} />);
  expect(
    screen.getByRole("textbox", { name: "Comando de instalação" }),
  ).toHaveProperty("value", `harness ${group} install investment-base`);
});
it("offers only actual agent components as scoped launch commands", () => {
  render(<PackageInstall item={plan.baseline[0]} />);
  expect(
    screen.getByRole("textbox", { name: "Iniciar investment-guide" }),
  ).toHaveProperty(
    "value",
    "harness vendor=claude --agent investment-base:investment-guide",
  );
  expect(
    screen.queryByRole("textbox", { name: "Iniciar go-practices" }),
  ).toBeNull();
});
it("omits a command for unsafe package identifiers", () => {
  render(
    <PackageInstall
      item={{
        ...plan.baseline[0],
        plugin: { ...plan.baseline[0].plugin, name: "unsafe; echo injected" },
      }}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
});
