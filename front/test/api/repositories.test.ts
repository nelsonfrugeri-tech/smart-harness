import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../src/api/client";
import { json } from "../../src/test/fixtures";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("allows the bounded sync operation more time while preserving the default request timeout", async () => {
  const timeouts = vi.spyOn(AbortSignal, "timeout");
  const fetcher = vi.fn(async () => json({}));
  vi.stubGlobal("fetch", fetcher);
  const signal = new AbortController().signal;
  await api.syncRepository("repository/one", "v1.0.0", "test-token", signal);
  expect(timeouts).toHaveBeenLastCalledWith(250000);
  expect(fetcher).toHaveBeenLastCalledWith(
    "/v1/repositories/repository%2Fone/sync",
    expect.objectContaining({
      method: "POST",
      body: '{"tag":"v1.0.0"}',
      credentials: "omit",
    }),
  );
  await api.repositories(undefined, "test-token", signal);
  expect(timeouts).toHaveBeenLastCalledWith(10000);
});
