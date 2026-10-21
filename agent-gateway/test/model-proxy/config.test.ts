import { describe, expect, it } from "vitest";
import { loadModelUpstream } from "../../src/model-proxy/config.ts";

describe("loadModelUpstream", () => {
  it("is undefined without a key", () => {
    expect(loadModelUpstream({})).toBeUndefined();
    expect(loadModelUpstream({ MODEL_UPSTREAM_KEY: "  " })).toBeUndefined();
  });

  it("defaults to the OpenRouter Anthropic-compatible endpoint", () => {
    expect(loadModelUpstream({ MODEL_UPSTREAM_KEY: "k" })).toEqual({ url: "https://openrouter.ai/api", key: "k" });
  });

  it("removes trailing slashes from the URL", () => {
    expect(loadModelUpstream({ MODEL_UPSTREAM_KEY: "k", MODEL_UPSTREAM_URL: "http://127.0.0.1:9/api//" })?.url).toBe(
      "http://127.0.0.1:9/api",
    );
  });

  it.each(["not a url", "ftp://example.com", "https://example.com/api?x=1"])("rejects %s", (url) => {
    expect(() => loadModelUpstream({ MODEL_UPSTREAM_KEY: "k", MODEL_UPSTREAM_URL: url })).toThrow(/MODEL_UPSTREAM_URL/);
  });

  it("does not put the key in the error message", () => {
    let message = "";
    try {
      loadModelUpstream({ MODEL_UPSTREAM_KEY: "secret-key-value", MODEL_UPSTREAM_URL: "nope" });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe("");
    expect(message).not.toContain("secret-key-value");
  });
});
