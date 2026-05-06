import type { AppMetrics } from "./metrics";

export type AppClassification =
  | "INSUFFICIENT_DATA"
  | "AT_RISK"
  | "DECLINING"
  | "SLIPPING"
  | "STABLE"
  | "GROWING"
  | "RECOVERING";

export interface AppScoring {
  /** null when opportunity eligibility conditions are not met or growthRate7d is null. */
  opportunityScore: number | null;
  /** null when risk eligibility conditions are not met or growthRate7d is null. */
  riskScore: number | null;
  isTopRecommendationEligible: boolean;
  classification: AppClassification;
}

const GROWTH_CAP = 2.0;
const DOWN_TREND_MULTIPLIER = 1.25;

const OPPORTUNITY_GROWTH_FLOOR = 0.1;
const RISK_GROWTH_CEILING = -0.1;
const AT_RISK_GROWTH_CEILING = -0.2;
const AT_RISK_IMPACT_FLOOR = 0.05;
const STABLE_GROWTH_ABS = 0.1;

const TOP_REC_MIN_REVENUE = 5000;
const TOP_REC_MIN_PORTFOLIO_SHARE = 0.05;
const TOP_REC_MIN_IMPACT_SHARE = 0.03;
const INSUFFICIENT_DATA_DAYS = 14;

/**
 * Computes opportunity/risk scores and app classification from pre-computed
 * AppMetrics. Pure function — no database access.
 *
 * @param metrics  Output of computeAppMetrics.
 * @param dataDayCount  Number of distinct days with revenue data inside the
 *   28-day window. Used to detect INSUFFICIENT_DATA.
 */
export function computeAppScoring(
  metrics: AppMetrics,
  dataDayCount: number
): AppScoring {
  const {
    absoluteDelta7d,
    growthRate7d,
    revenueImpactShare,
    trend28d,
    current7dRevenue,
    portfolioShare7d,
  } = metrics;

  // Opportunity score — only when app is growing fast enough
  let opportunityScore: number | null = null;
  if (
    growthRate7d !== null &&
    absoluteDelta7d > 0 &&
    growthRate7d >= OPPORTUNITY_GROWTH_FLOOR
  ) {
    opportunityScore =
      revenueImpactShare * (1 + Math.min(growthRate7d, GROWTH_CAP));
  }

  // Risk score — only when app is declining fast enough
  let riskScore: number | null = null;
  if (
    growthRate7d !== null &&
    absoluteDelta7d < 0 &&
    growthRate7d <= RISK_GROWTH_CEILING
  ) {
    const trendMultiplier =
      trend28d === "DOWN" ? DOWN_TREND_MULTIPLIER : 1.0;
    riskScore =
      revenueImpactShare *
      (1 + Math.min(Math.abs(growthRate7d), GROWTH_CAP)) *
      trendMultiplier;
  }

  const isTopRecommendationEligible =
    current7dRevenue >= TOP_REC_MIN_REVENUE &&
    portfolioShare7d >= TOP_REC_MIN_PORTFOLIO_SHARE &&
    revenueImpactShare >= TOP_REC_MIN_IMPACT_SHARE;

  const classification = classify(metrics, dataDayCount);

  return { opportunityScore, riskScore, isTopRecommendationEligible, classification };
}

function classify(metrics: AppMetrics, dataDayCount: number): AppClassification {
  const { growthRate7d, revenueImpactShare, trend28d } = metrics;

  if (dataDayCount < INSUFFICIENT_DATA_DAYS) return "INSUFFICIENT_DATA";
  if (growthRate7d === null) return "INSUFFICIENT_DATA";
  if (growthRate7d <= AT_RISK_GROWTH_CEILING && revenueImpactShare >= AT_RISK_IMPACT_FLOOR)
    return "AT_RISK";
  if (growthRate7d <= RISK_GROWTH_CEILING && trend28d === "DOWN") return "DECLINING";
  if (growthRate7d <= RISK_GROWTH_CEILING && trend28d !== "DOWN") return "SLIPPING";
  if (Math.abs(growthRate7d) < STABLE_GROWTH_ABS) return "STABLE";
  if (growthRate7d >= OPPORTUNITY_GROWTH_FLOOR && trend28d === "UP") return "GROWING";
  return "RECOVERING";
}
