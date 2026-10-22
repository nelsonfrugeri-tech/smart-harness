import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { useMarketplace } from "../../src/app/useMarketplace";
import { deferred, json, plan } from "../../src/test/fixtures";
const expire = () => {};
afterEach(() => vi.unstubAllGlobals());
it("refreshes after publication even while an older catalog request is pending", async () => {
  const pending = deferred<Response>();
  let calls = 0;
  let signal: AbortSignal | undefined;
  vi.stubGlobal(
    "fetch",
    vi.fn((_input: RequestInfo | URL, options?: RequestInit) => {
      calls++;
      if (calls === 1) {
        signal = options?.signal as AbortSignal;
        return pending.promise;
      }
      return Promise.resolve(json({ items: plan.baseline, next_cursor: null }));
    }),
  );
  function Probe() {
    const { state, restart } = useMarketplace({}, "test-token", expire);
    return (
      <>
        <button onClick={restart}>Refresh</button>
        <p>{state.items.map((item) => item.plugin.name).join(",")}</p>
      </>
    );
  }
  render(<Probe />);
  await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
  await screen.findByText("investment-base");
  expect(signal?.aborted).toBe(true);
  await act(async () =>
    pending.resolve(json({ items: [], next_cursor: null })),
  );
  expect(screen.getByText("investment-base")).toBeTruthy();
  expect(calls).toBe(2);
});
