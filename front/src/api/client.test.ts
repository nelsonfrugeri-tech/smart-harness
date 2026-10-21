import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { json, me } from "../test/fixtures";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("sends the bearer only as a header and uses the same-origin API", async () => {
  const fetch = vi.fn(async () => json(me));
  vi.stubGlobal("fetch", fetch);
  await api.me("private-token", new AbortController().signal);
  const [path, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
  expect(path).toBe("/v1/me");
  expect(init.headers).toHaveProperty("Authorization", "Bearer private-token");
  expect(init.cache).toBe("no-store");
  expect(init.credentials).toBe("omit");
});
it("maps an offline API to a recoverable error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new TypeError("offline");
    }),
  );
  await expect(
    api.me("token", new AbortController().signal),
  ).rejects.toMatchObject({ status: 0, code: "network_error" });
});
it("aborts a pending request at the timeout boundary", async () => {
  vi.useFakeTimers();
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), ms);
    return controller.signal;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ),
  );
  const result = expect(
    api.me("token", new AbortController().signal),
  ).rejects.toMatchObject({ status: 0, code: "timeout" });
  await vi.advanceTimersByTimeAsync(10000);
  await result;
  vi.restoreAllMocks();
});
it("distinguishes cancellation from an operational failure", async () => {
  const controller = new AbortController();
  controller.abort();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    }),
  );
  await expect(api.me("token", controller.signal)).rejects.toMatchObject({
    name: "AbortError",
  });
});
it("preserves problem correlation ids without trusting untyped fields", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json({ code: 123, correlation_id: "support-id" }, 503)),
  );
  await expect(
    api.me("token", new AbortController().signal),
  ).rejects.toMatchObject({
    status: 503,
    code: "http_error",
    correlationId: "support-id",
  });
});
