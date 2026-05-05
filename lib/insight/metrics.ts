export type Trend28d = "UP" | "DOWN" | "FLAT";

/** One day's worth of aggregated app revenue, sourced from DailyAppRevenue. */
export interface DailyRevenuePoint {
  date: Date;
  /** Net revenue for this day (grossRevenue + refunds). */
  netRevenue: number;
  /** Refunds only, zero or negative. */
  refunds: number;
}

export interface ComputeMetricsInput {
  /** 28-day series for a single app. Points outside the windows are ignored. */
  series: DailyRevenuePoint[];
  /** Sum of current7dRevenue across all mapped apps in the portfolio. */
  totalPortfolio7dRevenue: number;
  /**
   * The anchor date treated as "today" (day 0). Windows are computed relative
   * to this date, making the function fully deterministic under test.
   * Defaults to the current UTC day when omitted.
   */
  referenceDate?: Date;
}

export interface AppMetrics {
  current7dRevenue: number;
  previous7dRevenue: number;
  absoluteDelta7d: number;
  /** null when previous7dRevenue is 0 (avoids division by zero). */
  growthRate7d: number | null;
  /** current7dRevenue / totalPortfolio7dRevenue. 0 when portfolio total is 0. */
  portfolioShare7d: number;
  /** abs(absoluteDelta7d) / totalPortfolio7dRevenue. 0 when portfolio total is 0. */
  revenueImpactShare: number;
  last14dRevenue: number;
  prior14dRevenue: number;
  trend28d: Trend28d;
  /** Sum of refunds field for the current 7d window (zero or negative). */
  refunds7d: number;
  /**
   * true only when absoluteDelta7d < 0 and
   * abs(refunds7d) / abs(absoluteDelta7d) > 0.50.
   */
  isRefundDriven: boolean;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function toUtcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function daysBefore(reference: Date, n: number): Date {
  const d = toUtcDayStart(reference);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/**
 * Sums `field` for series points whose date falls within
 * [reference - endDaysBack, reference - startDaysBack] (both inclusive,
 * where startDaysBack is the more-recent boundary).
 *
 * Example: sumField(series, "netRevenue", 7, 1, ref)
 *   → sum of netRevenue for days -7 through -1.
 */
function sumField(
  series: DailyRevenuePoint[],
  field: keyof Pick<DailyRevenuePoint, "netRevenue" | "refunds">,
  farDaysBack: number,
  nearDaysBack: number,
  reference: Date
): number {
  const from = daysBefore(reference, farDaysBack);
  const to = daysBefore(reference, nearDaysBack);

  return series
    .filter((p) => {
      const d = toUtcDayStart(p.date);
      return d >= from && d <= to;
    })
    .reduce((sum, p) => sum + p[field], 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function computeAppMetrics(input: ComputeMetricsInput): AppMetrics {
  const { series, totalPortfolio7dRevenue } = input;
  const ref = input.referenceDate
    ? toUtcDayStart(input.referenceDate)
    : toUtcDayStart(new Date());

  const current7dRevenue = sumField(series, "netRevenue", 7, 1, ref);
  const previous7dRevenue = sumField(series, "netRevenue", 14, 8, ref);
  const last14dRevenue = sumField(series, "netRevenue", 14, 1, ref);
  const prior14dRevenue = sumField(series, "netRevenue", 28, 15, ref);
  const refunds7d = sumField(series, "refunds", 7, 1, ref);

  const absoluteDelta7d = current7dRevenue - previous7dRevenue;

  const growthRate7d =
    previous7dRevenue === 0
      ? null
      : absoluteDelta7d / previous7dRevenue;

  const portfolioShare7d =
    totalPortfolio7dRevenue === 0
      ? 0
      : current7dRevenue / totalPortfolio7dRevenue;

  const revenueImpactShare =
    totalPortfolio7dRevenue === 0
      ? 0
      : Math.abs(absoluteDelta7d) / totalPortfolio7dRevenue;

  let trend28d: Trend28d;
  if (last14dRevenue > prior14dRevenue * 1.05) {
    trend28d = "UP";
  } else if (last14dRevenue < prior14dRevenue * 0.95) {
    trend28d = "DOWN";
  } else {
    trend28d = "FLAT";
  }

  const isRefundDriven =
    absoluteDelta7d < 0 &&
    refunds7d !== 0 &&
    Math.abs(refunds7d) / Math.abs(absoluteDelta7d) > 0.5;

  return {
    current7dRevenue,
    previous7dRevenue,
    absoluteDelta7d,
    growthRate7d,
    portfolioShare7d,
    revenueImpactShare,
    last14dRevenue,
    prior14dRevenue,
    trend28d,
    refunds7d,
    isRefundDriven,
  };
}
