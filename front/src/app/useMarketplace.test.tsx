import { useLayoutEffect } from "react";
import { act, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { deferred, json, plan } from "../test/fixtures";
import { useMarketplace } from "./useMarketplace";
const expire = () => {};
it("hides the old query in the commit before passive effects reset its request", async () => {
  const pending = deferred<Response>();
  const snapshots: { kind: string; names: string[] }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("kind=mcp")
        ? pending.promise
        : json({ items: plan.baseline, next_cursor: null }),
    ),
  );
  function Probe({ kind }: { kind: "skill" | "mcp" }) {
    const { state } = useMarketplace({ kind }, "token-one", expire);
    useLayoutEffect(() => {
      snapshots.push({
        kind,
        names: state.items.map((item) => item.plugin.name),
      });
    });
    return (
      <div>
        {state.loading
          ? "Loading packages"
          : state.items.map((item) => item.plugin.name).join(",")}
      </div>
    );
  }
  const view = render(<Probe kind="skill" />);
  await screen.findByText("investment-base");
  view.rerender(<Probe kind="mcp" />);
  expect(
    snapshots
      .filter((snapshot) => snapshot.kind === "mcp")
      .every((snapshot) => snapshot.names.length === 0),
  ).toBe(true);
  await act(async () =>
    pending.resolve(json({ items: [], next_cursor: null })),
  );
});
