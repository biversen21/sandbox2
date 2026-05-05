import { db } from "@/lib/db";

export interface AggregationInput {
  userId: string;
  /** Inclusive. Normalized to start of UTC day internally. */
  startDate: Date;
  /** Inclusive. Normalized to end of UTC day internally. */
  endDate: Date;
}

export interface AggregationSummary {
  appsAggregated: number;
  daysAggregated: number;
  rowsUpserted: number;
  unmappedEventCount: number;
  excludedCurrencyEventCount: number;
}

function toUtcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function toUtcDayEnd(d: Date): Date {
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999)
  );
}

export async function aggregateDailyRevenue(
  input: AggregationInput
): Promise<AggregationSummary> {
  const { userId } = input;
  const startDate = toUtcDayStart(input.startDate);
  const endDate = toUtcDayEnd(input.endDate);

  // --- 1. Fetch all events in range ------------------------------------------
  const events = await db.normalizedRevenueEvent.findMany({
    where: { userId, occurredAt: { gte: startDate, lte: endDate } },
    select: {
      appId: true,
      occurredAt: true,
      amount: true,
      isPortfolioCurrency: true,
      eventType: true,
    },
  });

  // --- 2. Separate unmapped ---------------------------------------------------
  let unmappedEventCount = 0;
  const mapped = events.filter((e) => {
    if (e.appId === null) {
      unmappedEventCount++;
      return false;
    }
    return true;
  });

  // --- 3. Group by appId + UTC date ------------------------------------------
  type GroupKey = string;
  type EventRow = (typeof mapped)[number] & { appId: string };

  const groups = new Map<
    GroupKey,
    { appId: string; date: Date; events: EventRow[] }
  >();

  for (const event of mapped) {
    const utcDate = toUtcDayStart(event.occurredAt);
    const key = `${event.appId}|${utcDate.toISOString()}`;
    if (!groups.has(key)) {
      groups.set(key, { appId: event.appId as string, date: utcDate, events: [] });
    }
    groups.get(key)!.events.push(event as EventRow);
  }

  // --- 4. Compute and upsert -------------------------------------------------
  const appIds = new Set<string>();
  const dateKeys = new Set<string>();
  let totalExcludedCurrencyEventCount = 0;
  let rowsUpserted = 0;

  for (const group of groups.values()) {
    appIds.add(group.appId);
    dateKeys.add(group.date.toISOString());

    let grossRevenue = 0;
    let refunds = 0;
    let newSubscriptionRevenue = 0;
    let renewalRevenue = 0;
    let oneTimeRevenue = 0;
    let excludedCurrencyEventCount = 0;
    let excludedCurrencyGross = 0;

    for (const event of group.events) {
      if (!event.isPortfolioCurrency) {
        excludedCurrencyEventCount++;
        excludedCurrencyGross += event.amount;
        totalExcludedCurrencyEventCount++;
        continue;
      }

      if (event.eventType === "REFUND") {
        refunds += event.amount;
      } else {
        grossRevenue += event.amount;
        if (event.eventType === "SUBSCRIPTION_NEW") {
          newSubscriptionRevenue += event.amount;
        } else if (event.eventType === "SUBSCRIPTION_RENEWAL") {
          renewalRevenue += event.amount;
        } else if (event.eventType === "ONE_TIME_PAYMENT") {
          oneTimeRevenue += event.amount;
        }
      }
    }

    const netRevenue = grossRevenue + refunds;
    const data = {
      grossRevenue,
      refunds,
      netRevenue,
      newSubscriptionRevenue,
      renewalRevenue,
      oneTimeRevenue,
      excludedCurrencyEventCount,
      excludedCurrencyGross,
    };

    await db.dailyAppRevenue.upsert({
      where: { appId_date: { appId: group.appId, date: group.date } },
      create: { appId: group.appId, date: group.date, ...data },
      update: data,
    });

    rowsUpserted++;
  }

  return {
    appsAggregated: appIds.size,
    daysAggregated: dateKeys.size,
    rowsUpserted,
    unmappedEventCount,
    excludedCurrencyEventCount: totalExcludedCurrencyEventCount,
  };
}
