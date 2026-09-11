import { describe, expect, it } from "vitest";
import {
  fmtAgo,
  fmtBytes,
  fmtCount,
  fmtDays,
  fmtDuration,
  fmtRatio,
  fmtTime,
  fmtUsd,
  fmtUsdFloat,
} from "./format";

describe("fmtBytes", () => {
  it("renders sub-1K sizes in bytes", () => {
    expect(fmtBytes(900)).toBe("900B");
  });
  it("renders kilobytes to match the layout mock (184K)", () => {
    expect(fmtBytes(188_416)).toBe("184K");
  });
  it("renders megabytes", () => {
    expect(fmtBytes(2 * 1024 * 1024)).toBe("2.0M");
  });
});

describe("fmtDuration", () => {
  it("shows days+hours once past a day", () => {
    expect(fmtDuration(90_000)).toBe("1d 1h");
  });
  it("shows seconds under a minute", () => {
    expect(fmtDuration(45)).toBe("45s");
  });
});

describe("fmtAgo", () => {
  it("renders elapsed time relative to the given now", () => {
    const nowMs = 1_800_000_000_000;
    expect(fmtAgo(1_800_000_000 - 90, nowMs)).toBe("1m 30s ago");
  });
});

describe("fmtTime / fmtUsd sanity (pre-existing, kept as-is)", () => {
  it("fmtTime accepts unix seconds", () => {
    expect(() => fmtTime(1_800_000_000)).not.toThrow();
  });
  it("fmtUsd formats µUSDC as dollars with a requested precision", () => {
    expect(fmtUsd(14_200_000, 2)).toBe("$14.20");
  });
});

describe("fmtCount / fmtUsdFloat / fmtRatio / fmtDays", () => {
  it("groups large token counts so 2,357,943 is readable", () => {
    expect(fmtCount(2_357_943)).toBe("2,357,943");
    expect(fmtCount(0)).toBe("0");
  });

  it("formats a plain USD float, for author-reported dollars that never were µUSDC", () => {
    expect(fmtUsdFloat(3.970412)).toBe("$3.9704");
    expect(fmtUsdFloat(3.970412, 2)).toBe("$3.97");
  });

  it("marks a multiple as a multiple", () => {
    expect(fmtRatio(9.0918)).toBe("9.1×");
  });

  it("renders days over a day and drops to duration under one", () => {
    expect(fmtDays(2.42)).toBe("2.4d");
    expect(fmtDays(14.6)).toBe("15d");
    expect(fmtDays(0.5)).toBe("12h 0m");
  });

  it("returns an em dash rather than NaN for a non-finite age", () => {
    expect(fmtDays(Number.NaN)).toBe("—");
  });
});
