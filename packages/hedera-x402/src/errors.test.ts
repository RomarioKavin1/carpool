import { describe, it, expect } from "vitest";
import {
  fromHttpStatus,
  isRetryable,
  upstreamStatus,
  UpstreamBadRequest,
  UpstreamNotFound,
  UpstreamUnavailable,
} from "./errors.js";

describe("upstream error classification", () => {
  it("never retries a deterministic not-found", () => {
    const e = new UpstreamNotFound("pool abc");
    expect(isRetryable(e)).toBe(false);
    expect(upstreamStatus(e)).toBe(404);
    expect(e.message).toContain("pool abc");
  });

  it("never retries a bad request", () => {
    expect(isRetryable(new UpstreamBadRequest("malformed"))).toBe(false);
    expect(upstreamStatus(new UpstreamBadRequest("malformed"))).toBe(400);
  });

  it("retries a transient failure", () => {
    const e = new UpstreamUnavailable("503 from provider");
    expect(isRetryable(e)).toBe(true);
    expect(upstreamStatus(e)).toBe(502);
  });

  it("treats an unknown throw as transient, since a blip is likelier than a no", () => {
    expect(isRetryable(new Error("socket hang up"))).toBe(true);
    expect(isRetryable("string thrown")).toBe(true);
    expect(upstreamStatus(new Error("socket hang up"))).toBe(502);
  });

  it("maps upstream HTTP statuses onto the right class", () => {
    expect(fromHttpStatus(404, "x")).toBeInstanceOf(UpstreamNotFound);
    expect(fromHttpStatus(400, "x")).toBeInstanceOf(UpstreamBadRequest);
    expect(fromHttpStatus(429, "x")).toBeInstanceOf(UpstreamBadRequest);
    expect(fromHttpStatus(500, "x")).toBeInstanceOf(UpstreamUnavailable);
    expect(fromHttpStatus(503, "x")).toBeInstanceOf(UpstreamUnavailable);
  });
});
