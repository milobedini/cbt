// src/utils/thresholds.test.ts
import { readThresholds, K_DEFAULT, MIN_N_DEFAULT } from "./thresholds";

describe("thresholds", () => {
  const origEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("returns defaults when env is unset", () => {
    delete process.env.K_ANONYMITY_THRESHOLD;
    delete process.env.METRICS_MIN_N_FOR_DISPLAY;
    expect(readThresholds()).toEqual({
      k: K_DEFAULT,
      minN: MIN_N_DEFAULT,
      privacyMode: "production",
    });
  });

  it("honours env overrides in non-production", () => {
    process.env.NODE_ENV = "development";
    process.env.K_ANONYMITY_THRESHOLD = "1";
    process.env.METRICS_MIN_N_FOR_DISPLAY = "1";
    expect(readThresholds()).toEqual({ k: 1, minN: 1, privacyMode: "reduced" });
  });

  it("forces defaults in production when env tries to lower", () => {
    process.env.NODE_ENV = "production";
    process.env.K_ANONYMITY_THRESHOLD = "1";
    process.env.METRICS_MIN_N_FOR_DISPLAY = "1";
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(readThresholds()).toEqual({
      k: K_DEFAULT,
      minN: MIN_N_DEFAULT,
      privacyMode: "production",
    });
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("marks privacyMode reduced when values are below defaults (non-prod)", () => {
    process.env.NODE_ENV = "development";
    process.env.K_ANONYMITY_THRESHOLD = "3";
    delete process.env.METRICS_MIN_N_FOR_DISPLAY;
    expect(readThresholds().privacyMode).toBe("reduced");
  });
});
