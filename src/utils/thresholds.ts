// src/utils/thresholds.ts
export const K_DEFAULT = 5;
export const MIN_N_DEFAULT = 20;

export type Thresholds = {
  k: number;
  minN: number;
  privacyMode: "production" | "reduced";
};

export const readThresholds = (): Thresholds => {
  const isProd = process.env.NODE_ENV === "production";
  const envK = process.env.K_ANONYMITY_THRESHOLD;
  const envMinN = process.env.METRICS_MIN_N_FOR_DISPLAY;
  let k = envK !== undefined ? Number(envK) : K_DEFAULT;
  let minN = envMinN !== undefined ? Number(envMinN) : MIN_N_DEFAULT;

  if (isProd && (k < K_DEFAULT || minN < MIN_N_DEFAULT)) {
    console.warn(
      `🚨 thresholds: production environment attempted lower values (k=${k}, minN=${minN}); forcing defaults (k=${K_DEFAULT}, minN=${MIN_N_DEFAULT})`,
    );
    k = K_DEFAULT;
    minN = MIN_N_DEFAULT;
  }

  const privacyMode: "production" | "reduced" =
    k < K_DEFAULT || minN < MIN_N_DEFAULT ? "reduced" : "production";

  return { k, minN, privacyMode };
};
