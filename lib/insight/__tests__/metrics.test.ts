import { describe, it, expect } from "vitest";
import { computeAppMetrics } from "../metrics";
import type { DailyRevenuePoint } from "../metrics";

// ---------------------------------------------------------------------------
// Fixture helpers
//
// referenceDate = 2024-07-01 (day 0)
//   day -1  = 2024-06-30    day -8  = 2024-06-23
//   day -7  = 2024-06-25    day -14 = 2024-06-17
//   day -15 = 2024-06-16    day -28 = 2024-06-03
// ---------------------------------------------------------------------------

const REF = new Date("2024-07-01T00:00:00Z");

function pt(daysBack: number, netRevenue: number, refunds = 0): DailyRevenuePoint {
  const date = new Date(REF);
  date.setUTCDate(date.getUTCDate() - daysBack);
  return { date, netRevenue, refunds };
}

/** Uniform series: same value on every day from day -28 to -1. */
function uniform(netRevenue: number, refundsPerDay = 0): DailyRevenuePoint[] {
  return Array.from({ length: 28 }, (_, i) => pt(i + 1, netRevenue, refundsPerDay));
}

// ---------------------------------------------------------------------------
// Window calculations
// ---------------------------------------------------------------------------

describe("window calculations", () => {
  it("current7dRevenue sums days -7 to -1 only", () => {
    const series = [
      pt(1, 100), pt(2, 100), pt(3, 100), pt(4, 100),
      pt(5, 100), pt(6, 100), pt(7, 100),
      pt(8, 999), // previous window — must not be included
    ];
    const { current7dRevenue } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 700,
      referenceDate: REF,
    });
    expect(current7dRevenue).toBe(700);
  });

  it("previous7dRevenue sums days -14 to -8 only", () => {
    const series = [
      pt(7, 999),  // current window — must not be included
      pt(8, 200), pt(9, 200), pt(10, 200), pt(11, 200),
      pt(12, 200), pt(13, 200), pt(14, 200),
      pt(15, 999), // prior 14d window — must not be included
    ];
    const { previous7dRevenue } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1400,
      referenceDate: REF,
    });
    expect(previous7dRevenue).toBe(1400);
  });

  it("last14dRevenue sums days -14 to -1", () => {
    // 14 days × 50 = 700
    const series = Array.from({ length: 28 }, (_, i) =>
      pt(i + 1, i < 14 ? 50 : 0)
    );
    const { last14dRevenue } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 350,
      referenceDate: REF,
    });
    expect(last14dRevenue).toBe(700);
  });

  it("prior14dRevenue sums days -28 to -15", () => {
    // days 15-28 back each have value 75; days 1-14 back have 0
    const series = Array.from({ length: 28 }, (_, i) =>
      pt(i + 1, i >= 14 ? 75 : 0)
    );
    const { prior14dRevenue } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 0,
      referenceDate: REF,
    });
    expect(prior14dRevenue).toBe(75 * 14);
  });

  it("points outside the 28-day window are ignored", () => {
    const series = [
      pt(29, 10000), // day -29, outside all windows
      pt(1, 500),
    ];
    const { current7dRevenue, prior14dRevenue } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 500,
      referenceDate: REF,
    });
    expect(current7dRevenue).toBe(500);
    expect(prior14dRevenue).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Growth rate
// ---------------------------------------------------------------------------

describe("growthRate7d", () => {
  it("returns a positive growth rate when current > previous", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 1500)), // current: 10500
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 1000)), // previous: 7000
    ];
    const { growthRate7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 10500,
      referenceDate: REF,
    });
    // (10500 - 7000) / 7000 = 0.5
    expect(growthRate7d).toBeCloseTo(0.5);
  });

  it("returns a negative growth rate when current < previous", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 700)),   // current: 4900
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 1000)),  // previous: 7000
    ];
    const { growthRate7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 4900,
      referenceDate: REF,
    });
    // (4900 - 7000) / 7000 ≈ -0.3
    expect(growthRate7d).toBeCloseTo(-0.3);
  });

  it("returns null when previous7dRevenue is zero", () => {
    const series = Array.from({ length: 7 }, (_, i) => pt(i + 1, 500));
    const { growthRate7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 3500,
      referenceDate: REF,
    });
    expect(growthRate7d).toBeNull();
  });

  it("returns null when both current and previous are zero", () => {
    const { growthRate7d } = computeAppMetrics({
      series: [],
      totalPortfolio7dRevenue: 0,
      referenceDate: REF,
    });
    expect(growthRate7d).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// absoluteDelta7d
// ---------------------------------------------------------------------------

describe("absoluteDelta7d", () => {
  it("is positive when app is growing", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 200)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 100)),
    ];
    const { absoluteDelta7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1400,
      referenceDate: REF,
    });
    expect(absoluteDelta7d).toBe(700); // 1400 - 700
  });

  it("is negative when app is declining", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 100)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 200)),
    ];
    const { absoluteDelta7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 700,
      referenceDate: REF,
    });
    expect(absoluteDelta7d).toBe(-700); // 700 - 1400
  });
});

// ---------------------------------------------------------------------------
// Trend28d
// ---------------------------------------------------------------------------

describe("trend28d", () => {
  it("is UP when last14d > prior14d × 1.05", () => {
    // last14d (days -14 to -1): 110 each = 1540
    // prior14d (days -28 to -15): 100 each = 1400
    // 1540 / 1400 ≈ 1.10 → above 1.05 threshold
    const series = [
      ...Array.from({ length: 14 }, (_, i) => pt(i + 1, 110)),
      ...Array.from({ length: 14 }, (_, i) => pt(i + 15, 100)),
    ];
    const { trend28d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1540,
      referenceDate: REF,
    });
    expect(trend28d).toBe("UP");
  });

  it("is DOWN when last14d < prior14d × 0.95", () => {
    // last14d: 90 each = 1260
    // prior14d: 100 each = 1400
    // 1260 / 1400 = 0.90 → below 0.95 threshold
    const series = [
      ...Array.from({ length: 14 }, (_, i) => pt(i + 1, 90)),
      ...Array.from({ length: 14 }, (_, i) => pt(i + 15, 100)),
    ];
    const { trend28d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1260,
      referenceDate: REF,
    });
    expect(trend28d).toBe("DOWN");
  });

  it("is FLAT when last14d is within 5% of prior14d (above)", () => {
    // last14d: 103 each = 1442
    // prior14d: 100 each = 1400
    // 1442 / 1400 ≈ 1.03 → within ±5%
    const series = [
      ...Array.from({ length: 14 }, (_, i) => pt(i + 1, 103)),
      ...Array.from({ length: 14 }, (_, i) => pt(i + 15, 100)),
    ];
    const { trend28d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1442,
      referenceDate: REF,
    });
    expect(trend28d).toBe("FLAT");
  });

  it("is FLAT when last14d is within 5% of prior14d (below)", () => {
    // last14d: 97 × 14 = 1358
    // prior14d: 100 × 14 = 1400
    // 1358 / 1400 ≈ 0.97 → within ±5%
    const series = [
      ...Array.from({ length: 14 }, (_, i) => pt(i + 1, 97)),
      ...Array.from({ length: 14 }, (_, i) => pt(i + 15, 100)),
    ];
    const { trend28d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1358,
      referenceDate: REF,
    });
    expect(trend28d).toBe("FLAT");
  });

  it("is FLAT when both halves are zero", () => {
    const { trend28d } = computeAppMetrics({
      series: [],
      totalPortfolio7dRevenue: 0,
      referenceDate: REF,
    });
    expect(trend28d).toBe("FLAT");
  });

  it("is UP exactly at the 1.05 boundary (strictly greater)", () => {
    // last14d = prior14d × 1.05 exactly → NOT UP → FLAT
    const prior = 1000;
    const last = prior * 1.05;
    const series = [
      ...Array.from({ length: 14 }, (_, i) => pt(i + 1, last / 14)),
      ...Array.from({ length: 14 }, (_, i) => pt(i + 15, prior / 14)),
    ];
    const { trend28d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: last,
      referenceDate: REF,
    });
    expect(trend28d).toBe("FLAT");
  });
});

// ---------------------------------------------------------------------------
// Portfolio share and revenue impact
// ---------------------------------------------------------------------------

describe("portfolioShare7d and revenueImpactShare", () => {
  it("portfolioShare7d = current7dRevenue / totalPortfolio7dRevenue", () => {
    const series = Array.from({ length: 7 }, (_, i) => pt(i + 1, 200));
    const { portfolioShare7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 4000, // 1400 / 4000 = 0.35
      referenceDate: REF,
    });
    expect(portfolioShare7d).toBeCloseTo(0.35);
  });

  it("revenueImpactShare = abs(absoluteDelta7d) / totalPortfolio7dRevenue", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 300)), // current: 2100
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 100)), // previous: 700
    ];
    // delta = 1400, portfolio = 10000, impact = 0.14
    const { revenueImpactShare } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 10000,
      referenceDate: REF,
    });
    expect(revenueImpactShare).toBeCloseTo(0.14);
  });

  it("portfolioShare7d is 0 when totalPortfolio7dRevenue is 0", () => {
    const { portfolioShare7d } = computeAppMetrics({
      series: uniform(500),
      totalPortfolio7dRevenue: 0,
      referenceDate: REF,
    });
    expect(portfolioShare7d).toBe(0);
  });

  it("revenueImpactShare is 0 when totalPortfolio7dRevenue is 0", () => {
    const { revenueImpactShare } = computeAppMetrics({
      series: uniform(500),
      totalPortfolio7dRevenue: 0,
      referenceDate: REF,
    });
    expect(revenueImpactShare).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Refund-driven decline
// ---------------------------------------------------------------------------

describe("isRefundDriven", () => {
  it("is true when refunds account for more than 50% of the decline", () => {
    // current: 7 × 100 = 700 net, but refunds = -600 in current window
    // previous: 7 × 200 = 1400
    // absoluteDelta7d = 700 - 1400 = -700
    // refunds7d = -600 → abs(600) / abs(-700) ≈ 0.857 > 0.50
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 100, -600 / 7)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 200)),
    ];
    const { isRefundDriven } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 700,
      referenceDate: REF,
    });
    expect(isRefundDriven).toBe(true);
  });

  it("is false when refunds are less than 50% of the decline", () => {
    // current: 700, previous: 1400, delta = -700
    // refunds7d = -300 → abs(300) / abs(-700) ≈ 0.43 < 0.50
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 100, -300 / 7)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 200)),
    ];
    const { isRefundDriven } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 700,
      referenceDate: REF,
    });
    expect(isRefundDriven).toBe(false);
  });

  it("is false when absoluteDelta7d is positive (not a decline)", () => {
    // Growing app — refunds don't matter for isRefundDriven
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 200, -500 / 7)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 100)),
    ];
    const { isRefundDriven } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 1400,
      referenceDate: REF,
    });
    expect(isRefundDriven).toBe(false);
  });

  it("is false when absoluteDelta7d is zero", () => {
    const series = uniform(500, -50);
    const { isRefundDriven } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 3500,
      referenceDate: REF,
    });
    expect(isRefundDriven).toBe(false);
  });

  it("is false when there are no refunds despite a decline", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 100)),
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 200)),
    ];
    const { isRefundDriven } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 700,
      referenceDate: REF,
    });
    expect(isRefundDriven).toBe(false);
  });

  it("refunds7d sums only the refunds field for days -7 to -1", () => {
    const series = [
      ...Array.from({ length: 7 }, (_, i) => pt(i + 1, 500, -100)),   // current: refunds = -700
      ...Array.from({ length: 7 }, (_, i) => pt(i + 8, 500, -9999)),  // previous: excluded
    ];
    const { refunds7d } = computeAppMetrics({
      series,
      totalPortfolio7dRevenue: 3500,
      referenceDate: REF,
    });
    expect(refunds7d).toBeCloseTo(-700);
  });
});
