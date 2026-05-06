import { describe, it, expect } from "vitest";
import { computeAppScoring } from "../scoring";
import type { AppMetrics } from "../metrics";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeMetrics(overrides: Partial<AppMetrics> = {}): AppMetrics {
  return {
    current7dRevenue: 10000,
    previous7dRevenue: 9000,
    absoluteDelta7d: 1000,
    growthRate7d: 1000 / 9000,
    portfolioShare7d: 0.1,
    revenueImpactShare: 0.1,
    last14dRevenue: 19000,
    prior14dRevenue: 18000,
    trend28d: "FLAT",
    refunds7d: 0,
    isRefundDriven: false,
    ...overrides,
  };
}

/** 14 distinct days — just enough to satisfy INSUFFICIENT_DATA threshold. */
const ENOUGH_DAYS = 14;

// ---------------------------------------------------------------------------
// Opportunity score
// ---------------------------------------------------------------------------

describe("opportunityScore", () => {
  it("computes the formula: revenueImpactShare × (1 + growthRate7d)", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: 500,
      growthRate7d: 0.5,
      revenueImpactShare: 0.2,
    });
    const { opportunityScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 0.5) = 0.30
    expect(opportunityScore).toBeCloseTo(0.3);
  });

  it("caps growthRate7d at 2.0 in the formula", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: 500,
      growthRate7d: 5.0,
      revenueImpactShare: 0.2,
    });
    const { opportunityScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 2.0) = 0.60
    expect(opportunityScore).toBeCloseTo(0.6);
  });

  it("is null when absoluteDelta7d is zero", () => {
    const metrics = makeMetrics({ absoluteDelta7d: 0, growthRate7d: 0.5 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).opportunityScore).toBeNull();
  });

  it("is null when absoluteDelta7d is negative", () => {
    const metrics = makeMetrics({ absoluteDelta7d: -100, growthRate7d: 0.5 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).opportunityScore).toBeNull();
  });

  it("is null when growthRate7d is below 0.10", () => {
    const metrics = makeMetrics({ absoluteDelta7d: 500, growthRate7d: 0.09 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).opportunityScore).toBeNull();
  });

  it("is null when growthRate7d is null", () => {
    const metrics = makeMetrics({ absoluteDelta7d: 500, growthRate7d: null });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).opportunityScore).toBeNull();
  });

  it("is computed at exactly the 0.10 boundary (inclusive)", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: 500,
      growthRate7d: 0.1,
      revenueImpactShare: 0.2,
    });
    const { opportunityScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 0.1) = 0.22
    expect(opportunityScore).toBeCloseTo(0.22);
  });
});

// ---------------------------------------------------------------------------
// Risk score
// ---------------------------------------------------------------------------

describe("riskScore", () => {
  it("computes the formula: revenueImpactShare × (1 + abs(growthRate7d)) × 1.0 (FLAT trend)", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: -500,
      growthRate7d: -0.5,
      revenueImpactShare: 0.2,
      trend28d: "FLAT",
    });
    const { riskScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 0.5) × 1.0 = 0.30
    expect(riskScore).toBeCloseTo(0.3);
  });

  it("applies 1.25× multiplier when trend28d is DOWN", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: -500,
      growthRate7d: -0.5,
      revenueImpactShare: 0.2,
      trend28d: "DOWN",
    });
    const { riskScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 0.5) × 1.25 = 0.375
    expect(riskScore).toBeCloseTo(0.375);
  });

  it("applies 1.0× multiplier when trend28d is UP", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: -500,
      growthRate7d: -0.5,
      revenueImpactShare: 0.2,
      trend28d: "UP",
    });
    const { riskScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    expect(riskScore).toBeCloseTo(0.3);
  });

  it("caps abs(growthRate7d) at 2.0 in the formula", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: -500,
      growthRate7d: -5.0,
      revenueImpactShare: 0.2,
      trend28d: "FLAT",
    });
    const { riskScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 2.0) × 1.0 = 0.60
    expect(riskScore).toBeCloseTo(0.6);
  });

  it("is null when absoluteDelta7d is zero", () => {
    const metrics = makeMetrics({ absoluteDelta7d: 0, growthRate7d: -0.5 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).riskScore).toBeNull();
  });

  it("is null when absoluteDelta7d is positive", () => {
    const metrics = makeMetrics({ absoluteDelta7d: 100, growthRate7d: -0.5 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).riskScore).toBeNull();
  });

  it("is null when growthRate7d is above -0.10", () => {
    const metrics = makeMetrics({ absoluteDelta7d: -100, growthRate7d: -0.09 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).riskScore).toBeNull();
  });

  it("is null when growthRate7d is null", () => {
    const metrics = makeMetrics({ absoluteDelta7d: -100, growthRate7d: null });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).riskScore).toBeNull();
  });

  it("is computed at exactly the -0.10 boundary (inclusive)", () => {
    const metrics = makeMetrics({
      absoluteDelta7d: -500,
      growthRate7d: -0.1,
      revenueImpactShare: 0.2,
      trend28d: "FLAT",
    });
    const { riskScore } = computeAppScoring(metrics, ENOUGH_DAYS);
    // 0.2 × (1 + 0.1) × 1.0 = 0.22
    expect(riskScore).toBeCloseTo(0.22);
  });
});

// ---------------------------------------------------------------------------
// Top recommendation eligibility
// ---------------------------------------------------------------------------

describe("isTopRecommendationEligible", () => {
  it("is true when all three thresholds are met", () => {
    const metrics = makeMetrics({
      current7dRevenue: 5000,
      portfolioShare7d: 0.05,
      revenueImpactShare: 0.03,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(true);
  });

  it("is false when current7dRevenue is below 5000", () => {
    const metrics = makeMetrics({
      current7dRevenue: 4999,
      portfolioShare7d: 0.05,
      revenueImpactShare: 0.03,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(false);
  });

  it("is false when portfolioShare7d is below 0.05", () => {
    const metrics = makeMetrics({
      current7dRevenue: 5000,
      portfolioShare7d: 0.049,
      revenueImpactShare: 0.03,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(false);
  });

  it("is false when revenueImpactShare is below 0.03", () => {
    const metrics = makeMetrics({
      current7dRevenue: 5000,
      portfolioShare7d: 0.05,
      revenueImpactShare: 0.029,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(false);
  });

  it("is true at exactly the revenueImpactShare 0.03 boundary", () => {
    const metrics = makeMetrics({
      current7dRevenue: 5000,
      portfolioShare7d: 0.05,
      revenueImpactShare: 0.03,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(true);
  });

  it("is true at exactly the portfolioShare7d 0.05 boundary", () => {
    const metrics = makeMetrics({
      current7dRevenue: 5000,
      portfolioShare7d: 0.05,
      revenueImpactShare: 0.03,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).isTopRecommendationEligible).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

describe("classification", () => {
  it("INSUFFICIENT_DATA when dataDayCount < 14", () => {
    const metrics = makeMetrics({ growthRate7d: -0.5, revenueImpactShare: 0.2 });
    expect(computeAppScoring(metrics, 13).classification).toBe("INSUFFICIENT_DATA");
  });

  it("INSUFFICIENT_DATA when dataDayCount is 0", () => {
    const metrics = makeMetrics();
    expect(computeAppScoring(metrics, 0).classification).toBe("INSUFFICIENT_DATA");
  });

  it("INSUFFICIENT_DATA when growthRate7d is null (most conservative fallback)", () => {
    const metrics = makeMetrics({ growthRate7d: null });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("INSUFFICIENT_DATA");
  });

  it("AT_RISK when growthRate7d <= -0.20 and revenueImpactShare >= 0.05", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.25,
      revenueImpactShare: 0.1,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("AT_RISK");
  });

  it("AT_RISK at exact boundaries: growthRate7d = -0.20, revenueImpactShare = 0.05", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.2,
      revenueImpactShare: 0.05,
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("AT_RISK");
  });

  it("not AT_RISK when revenueImpactShare < 0.05 (falls through to DECLINING)", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.25,
      revenueImpactShare: 0.04,
      trend28d: "DOWN",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("DECLINING");
  });

  it("DECLINING when growthRate7d <= -0.10 and trend28d is DOWN (not AT_RISK)", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.15,
      revenueImpactShare: 0.04, // below AT_RISK threshold
      trend28d: "DOWN",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("DECLINING");
  });

  it("DECLINING at exactly growthRate7d = -0.10 with trend DOWN", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.1,
      revenueImpactShare: 0.04,
      trend28d: "DOWN",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("DECLINING");
  });

  it("SLIPPING when growthRate7d <= -0.10 and trend28d is FLAT", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.15,
      revenueImpactShare: 0.04,
      trend28d: "FLAT",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("SLIPPING");
  });

  it("SLIPPING when growthRate7d <= -0.10 and trend28d is UP", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.15,
      revenueImpactShare: 0.04,
      trend28d: "UP",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("SLIPPING");
  });

  it("STABLE when abs(growthRate7d) < 0.10 (positive)", () => {
    const metrics = makeMetrics({ growthRate7d: 0.09 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("STABLE");
  });

  it("STABLE when abs(growthRate7d) < 0.10 (negative)", () => {
    const metrics = makeMetrics({ growthRate7d: -0.09 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("STABLE");
  });

  it("STABLE when growthRate7d is exactly 0", () => {
    const metrics = makeMetrics({ growthRate7d: 0 });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("STABLE");
  });

  it("not STABLE at exactly growthRate7d = 0.10 (abs is not strictly < 0.10)", () => {
    const metrics = makeMetrics({ growthRate7d: 0.1, trend28d: "UP" });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("GROWING");
  });

  it("not STABLE at exactly growthRate7d = -0.10 with trend DOWN", () => {
    const metrics = makeMetrics({
      growthRate7d: -0.1,
      revenueImpactShare: 0.04,
      trend28d: "DOWN",
    });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("DECLINING");
  });

  it("GROWING when growthRate7d >= 0.10 and trend28d is UP", () => {
    const metrics = makeMetrics({ growthRate7d: 0.2, trend28d: "UP" });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("GROWING");
  });

  it("GROWING at exactly growthRate7d = 0.10 with trend UP", () => {
    const metrics = makeMetrics({ growthRate7d: 0.1, trend28d: "UP" });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("GROWING");
  });

  it("RECOVERING when growthRate7d >= 0.10 and trend28d is FLAT", () => {
    const metrics = makeMetrics({ growthRate7d: 0.2, trend28d: "FLAT" });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("RECOVERING");
  });

  it("RECOVERING when growthRate7d >= 0.10 and trend28d is DOWN", () => {
    const metrics = makeMetrics({ growthRate7d: 0.2, trend28d: "DOWN" });
    expect(computeAppScoring(metrics, ENOUGH_DAYS).classification).toBe("RECOVERING");
  });

  it("does not crash when growthRate7d is null with dataDayCount >= 14", () => {
    const metrics = makeMetrics({ growthRate7d: null });
    expect(() => computeAppScoring(metrics, ENOUGH_DAYS)).not.toThrow();
  });
});
