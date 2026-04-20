// src/utils/careTier.test.ts
import { deriveCareTier } from "./careTier";

describe("deriveCareTier", () => {
  it("returns self_help when attempt has no therapist", () => {
    expect(
      deriveCareTier({ attemptTherapistId: null, therapistTierLookup: {} }),
    ).toBe("self_help");
  });

  it("returns cbt_guided when therapist tier is cbt", () => {
    expect(
      deriveCareTier({
        attemptTherapistId: "t1",
        therapistTierLookup: { t1: "cbt" },
      }),
    ).toBe("cbt_guided");
  });

  it("returns pwp_guided when therapist tier is pwp", () => {
    expect(
      deriveCareTier({
        attemptTherapistId: "t1",
        therapistTierLookup: { t1: "pwp" },
      }),
    ).toBe("pwp_guided");
  });

  it("falls back to self_help when therapist id is present but missing from lookup", () => {
    expect(
      deriveCareTier({
        attemptTherapistId: "t99",
        therapistTierLookup: { t1: "cbt" },
      }),
    ).toBe("self_help");
  });

  it("falls back to self_help when therapist tier is null", () => {
    expect(
      deriveCareTier({
        attemptTherapistId: "t1",
        therapistTierLookup: { t1: null as unknown as "cbt" },
      }),
    ).toBe("self_help");
  });
});
