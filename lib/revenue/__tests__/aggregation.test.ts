import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { aggregateDailyRevenue } from "../aggregation";
import type { RevenueEventType, RevenueSource } from "@/app/generated/prisma/client";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let userId: string;
let appId1: string;
let appId2: string;
let dataSourceId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: { email: `agg-test-${Date.now()}@test.com` },
  });
  userId = user.id;

  const ds = await db.dataSource.create({
    data: { userId, source: "STRIPE", displayName: "Test", status: "ACTIVE" },
  });
  dataSourceId = ds.id;

  [appId1, appId2] = await Promise.all([
    db.app.create({ data: { userId, name: "App One" } }).then((a) => a.id),
    db.app.create({ data: { userId, name: "App Two" } }).then((a) => a.id),
  ]);
});

afterEach(async () => {
  await db.dailyAppRevenue.deleteMany({ where: { appId: { in: [appId1, appId2] } } });
  await db.normalizedRevenueEvent.deleteMany({ where: { userId } });
});

afterAll(async () => {
  await db.app.deleteMany({ where: { userId } });
  await db.dataSource.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let seq = 0;
async function insertEvent(opts: {
  appId?: string | null;
  amount: number;
  eventType: RevenueEventType;
  occurredAt?: Date;
  isPortfolioCurrency?: boolean;
  currency?: string;
}) {
  const sourceEventId = `evt_${Date.now()}_${++seq}`;
  return db.normalizedRevenueEvent.create({
    data: {
      idempotencyKey: `stripe:${sourceEventId}`,
      userId,
      source: "STRIPE" as RevenueSource,
      sourceEventId,
      eventType: opts.eventType,
      occurredAt: opts.occurredAt ?? new Date("2024-06-01T10:00:00Z"),
      amount: opts.amount,
      currency: opts.currency ?? "USD",
      isPortfolioCurrency: opts.isPortfolioCurrency ?? true,
      appId: opts.appId !== undefined ? opts.appId : appId1,
    },
  });
}

const DAY1 = new Date("2024-06-01T00:00:00Z");
const DAY2 = new Date("2024-06-02T00:00:00Z");
const DAY3 = new Date("2024-06-03T00:00:00Z");

function midday(day: Date) {
  return new Date(day.getTime() + 12 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Grouping
// ---------------------------------------------------------------------------

describe("grouping by appId and date", () => {
  it("produces one row per appId+date combination", async () => {
    await insertEvent({ amount: 1000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 500, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY2) });
    await insertEvent({ appId: appId2, amount: 800, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });

    const summary = await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY2 });

    expect(summary.rowsUpserted).toBe(3);
    expect(summary.appsAggregated).toBe(2);
    expect(summary.daysAggregated).toBe(2);
  });

  it("combines multiple events on the same appId+date into one row", async () => {
    await insertEvent({ amount: 999, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 999, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row).not.toBeNull();
    expect(row!.grossRevenue).toBe(1998);
  });

  it("ignores events outside the requested date range", async () => {
    await insertEvent({ amount: 1000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 500, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY3) });

    const summary = await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY2 });

    expect(summary.rowsUpserted).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Revenue math
// ---------------------------------------------------------------------------

describe("gross / refund / net revenue calculation", () => {
  it("computes grossRevenue as sum of non-refund portfolio-currency amounts", async () => {
    await insertEvent({ amount: 2999, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 999, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.grossRevenue).toBe(3998);
  });

  it("computes refunds as a negative sum", async () => {
    await insertEvent({ amount: 2999, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: -2999, eventType: "REFUND", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.refunds).toBe(-2999);
    expect(row!.grossRevenue).toBe(2999);
    expect(row!.netRevenue).toBe(0);
  });

  it("computes netRevenue as grossRevenue + refunds", async () => {
    await insertEvent({ amount: 5000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: -1000, eventType: "REFUND", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.netRevenue).toBe(4000);
  });
});

// ---------------------------------------------------------------------------
// Event type breakdowns
// ---------------------------------------------------------------------------

describe("subscription / one-time breakdowns", () => {
  it("correctly attributes each event type to its revenue bucket", async () => {
    await insertEvent({ amount: 3000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 1500, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1) });
    await insertEvent({ amount: 500, eventType: "ONE_TIME_PAYMENT", occurredAt: midday(DAY1) });
    await insertEvent({ amount: -500, eventType: "REFUND", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.newSubscriptionRevenue).toBe(3000);
    expect(row!.renewalRevenue).toBe(1500);
    expect(row!.oneTimeRevenue).toBe(500);
    expect(row!.grossRevenue).toBe(5000);
    expect(row!.refunds).toBe(-500);
    expect(row!.netRevenue).toBe(4500);
  });

  it("leaves a bucket at zero when no events of that type exist", async () => {
    await insertEvent({ amount: 999, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.newSubscriptionRevenue).toBe(0);
    expect(row!.oneTimeRevenue).toBe(0);
    expect(row!.refunds).toBe(0);
    expect(row!.renewalRevenue).toBe(999);
  });
});

// ---------------------------------------------------------------------------
// Unmapped events
// ---------------------------------------------------------------------------

describe("excluding unmapped events", () => {
  it("does not create a DailyAppRevenue row for events with appId = null", async () => {
    await insertEvent({ appId: null, amount: 5000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });

    const summary = await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    expect(summary.unmappedEventCount).toBe(1);
    expect(summary.rowsUpserted).toBe(0);
  });

  it("counts unmapped events correctly when mixed with mapped events", async () => {
    await insertEvent({ appId: appId1, amount: 1000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ appId: null, amount: 2000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ appId: null, amount: 3000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });

    const summary = await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    expect(summary.unmappedEventCount).toBe(2);
    expect(summary.rowsUpserted).toBe(1);

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.grossRevenue).toBe(1000);
  });
});

// ---------------------------------------------------------------------------
// Non-portfolio currency exclusion
// ---------------------------------------------------------------------------

describe("non-portfolio currency handling", () => {
  it("excludes non-portfolio currency events from revenue totals", async () => {
    await insertEvent({ amount: 3000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1), isPortfolioCurrency: true });
    await insertEvent({ amount: 2000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1), isPortfolioCurrency: false, currency: "GBP" });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.grossRevenue).toBe(3000);
    expect(row!.netRevenue).toBe(3000);
  });

  it("records excludedCurrencyEventCount and excludedCurrencyGross on the row", async () => {
    await insertEvent({ amount: 1000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1), isPortfolioCurrency: true });
    await insertEvent({ amount: 800, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1), isPortfolioCurrency: false, currency: "EUR" });
    await insertEvent({ amount: 600, eventType: "ONE_TIME_PAYMENT", occurredAt: midday(DAY1), isPortfolioCurrency: false, currency: "GBP" });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.excludedCurrencyEventCount).toBe(2);
    expect(row!.excludedCurrencyGross).toBe(1400);
  });

  it("returns total excludedCurrencyEventCount across all apps in the summary", async () => {
    await insertEvent({ appId: appId1, amount: 500, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1), isPortfolioCurrency: false, currency: "GBP" });
    await insertEvent({ appId: appId2, amount: 400, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1), isPortfolioCurrency: false, currency: "EUR" });

    const summary = await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    expect(summary.excludedCurrencyEventCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Idempotent re-aggregation
// ---------------------------------------------------------------------------

describe("idempotent re-aggregation", () => {
  it("produces the same result when run twice over the same events", async () => {
    await insertEvent({ amount: 2999, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await insertEvent({ amount: -500, eventType: "REFUND", occurredAt: midday(DAY1) });

    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });
    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const rows = await db.dailyAppRevenue.findMany({
      where: { appId: appId1 },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].grossRevenue).toBe(2999);
    expect(rows[0].refunds).toBe(-500);
    expect(rows[0].netRevenue).toBe(2499);
  });

  it("updates the row when new events are added and aggregation re-runs", async () => {
    await insertEvent({ amount: 1000, eventType: "SUBSCRIPTION_NEW", occurredAt: midday(DAY1) });
    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    await insertEvent({ amount: 500, eventType: "SUBSCRIPTION_RENEWAL", occurredAt: midday(DAY1) });
    await aggregateDailyRevenue({ userId, startDate: DAY1, endDate: DAY1 });

    const row = await db.dailyAppRevenue.findUnique({
      where: { appId_date: { appId: appId1, date: DAY1 } },
    });
    expect(row!.grossRevenue).toBe(1500);
    expect(row!.renewalRevenue).toBe(500);
  });
});
