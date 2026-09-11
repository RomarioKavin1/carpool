import { describe, expect, it } from "vitest";
import { ApiError, getPayouts } from "./api";

describe("ApiError", () => {
  it("distinguishes an unreachable registry from one that answered and refused", () => {
    // These need different copy and different advice. Collapsing them into one
    // "error" state is what makes a dashboard useless the first time someone
    // opens it with nothing running.
    expect(new ApiError("/state", null, "cannot reach").offline).toBe(true);
    expect(new ApiError("/search", 503, "could not embed").offline).toBe(false);
  });
});

describe("getPayouts", () => {
  it("refuses a blank payee at the call site rather than 401ing at the registry", async () => {
    // GET /payouts is open ONLY in its ?payee= form; the unscoped table is
    // gated by the operator secret, which this app does not hold. A call that
    // could silently drop the scope would fail as a runtime 401 instead of
    // being impossible to express.
    for (const blank of ["", "   "]) {
      await expect(getPayouts(blank)).rejects.toBeInstanceOf(ApiError);
      await expect(getPayouts(blank)).rejects.toThrow(/payee is required/);
    }
  });

  it("reports the refusal as an ApiError against /payouts, not as a network failure", async () => {
    await expect(getPayouts("")).rejects.toMatchObject({ path: "/payouts", status: null });
  });
});
