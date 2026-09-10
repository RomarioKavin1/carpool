import { describe, it, expect } from "vitest";
import { normalizeQuestion, isSameQuestion, findDuplicateQuestion } from "./normalize.js";

describe("normalizeQuestion", () => {
  it("lowercases", () => {
    expect(normalizeQuestion("What Is The Prize Pool?")).toBe("what is the prize pool");
  });

  it("collapses internal whitespace runs (including newlines/tabs) to a single space", () => {
    expect(normalizeQuestion("what   is\n\tthe pool")).toBe("what is the pool");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeQuestion("  what is the pool  ")).toBe("what is the pool");
  });

  it("strips trailing punctuation", () => {
    expect(normalizeQuestion("what is the pool?")).toBe("what is the pool");
    expect(normalizeQuestion("what is the pool!!!")).toBe("what is the pool");
    expect(normalizeQuestion("what is the pool...")).toBe("what is the pool");
  });

  it("strips trailing punctuation mixed with trailing whitespace, in either order", () => {
    expect(normalizeQuestion("what is the pool? ")).toBe("what is the pool");
    expect(normalizeQuestion("what is the pool ?")).toBe("what is the pool");
  });

  it("never touches interior punctuation that carries meaning", () => {
    expect(normalizeQuestion("What's the prize pool, e.g. for sponsors?")).toBe(
      "what's the prize pool, e.g. for sponsors",
    );
  });

  it("two differently-punctuated phrasings of the same question normalise identically", () => {
    const a = normalizeQuestion("  What is the ETHOnline 2026 prize pool?  ");
    const b = normalizeQuestion("what is the ethonline 2026 prize pool");
    expect(a).toBe(b);
  });

  it("is idempotent", () => {
    const once = normalizeQuestion("What is the pool?");
    expect(normalizeQuestion(once)).toBe(once);
  });
});

describe("isSameQuestion", () => {
  it("is true for two phrasings that normalise identically", () => {
    expect(isSameQuestion("What is the pool?", "  what is the pool  ")).toBe(true);
  });

  it("is false for genuinely different questions", () => {
    expect(isSameQuestion("What is the pool?", "Who won the pool?")).toBe(false);
  });
});

describe("findDuplicateQuestion", () => {
  it("finds a match by re-normalising each candidate's question, not by trusting questionNorm", () => {
    const existing = [
      { question: "What is the pool?", questionNorm: "garbage-not-actually-normalised" },
      { question: "Who won?", questionNorm: "who won" },
    ];
    // The first candidate's questionNorm is deliberately wrong (simulating an
    // author-supplied field the registry didn't validate) — a match must
    // still be found because findDuplicateQuestion never reads questionNorm.
    const found = findDuplicateQuestion("what is the pool", existing);
    expect(found).toBe(existing[0]);
  });

  it("returns undefined when the question is new", () => {
    const existing = [{ question: "What is the pool?" }];
    expect(findDuplicateQuestion("Who won the airdrop?", existing)).toBeUndefined();
  });

  it("returns undefined for an empty existing list", () => {
    expect(findDuplicateQuestion("What is the pool?", [])).toBeUndefined();
  });

  it("matches regardless of case, whitespace or trailing punctuation differences", () => {
    const existing = [{ question: "  What Is   The Prize Pool??  " }];
    expect(findDuplicateQuestion("what is the prize pool", existing)).toBe(existing[0]);
  });
});
