import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { ingestRevenueEvents } from "../ingestion";
import type { NormalizedRevenueEventInput } from "../types";

// ---------------------------------------------------------------------------
// Shared fixtures — created once, cleaned between tests
// ---------------------------------------------------------------------------

let userId: string;
let dataSourceId: string;
let appId: string;

beforeAll(async () => {
  const user = await db.user.create({
    data: { email: `ingestion-test-${Date.now()}@test.com` },
  });
  userId = user.id;

  const ds = await db.dataSource.create({
    data: {
      userId,
      source: "STRIPE",
      displayName: "Test Stripe",
      status: "ACTIVE",
    },
  });
  dataSourceId = ds.id;

  const app = await db.app.create({
    data: { userId, name: "Test App" },
  });
  appId = app.id;
});

afterEach(async () => {
  await db.normalizedRevenueEvent.deleteMany({ where: { userId } });
  await db.externalProduct.deleteMany({ where: { dataSourceId } });
});

afterAll(async () => {
  await db.app.deleteMany({ where: { userId } });
  await db.dataSource.deleteMany({ where: { userId } });
  await db.user.delete({ where: { id: userId } });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(
  overrides: Partial<NormalizedRevenueEventInput> = {}
): NormalizedRevenueEventInput {
  const sourceEventId = overrides.sourceEventId ?? `pi_${Date.now()}_${Math.random()}`;
  return {
    source: "STRIPE",
    sourceEventId,
    idempotencyKey: `stripe:${sourceEventId}`,
    eventType: "SUBSCRIPTION_NEW",
    occurredAt: new Date("2024-06-01T10:00:00Z"),
    amount: 2999,
    currency: "USD",
    ...overrides,
  };
}

function baseInput(events: NormalizedRevenueEventInput[]) {
  return { userId, dataSourceId, portfolioCurrency: "USD", events };
}

// ---------------------------------------------------------------------------
// Inserting valid events
// ---------------------------------------------------------------------------

describe("inserting valid events", () => {
  it("inserts a single valid event and returns correct summary", async () => {
    const summary = await ingestRevenueEvents(baseInput([makeEvent()]));

    expect(summary.receivedCount).toBe(1);
    expect(summary.insertedCount).toBe(1);
    expect(summary.skippedDuplicateCount).toBe(0);
    expect(summary.invalidCount).toBe(0);
  });

  it("inserts multiple valid events in one call", async () => {
    const events = [
      makeEvent({ sourceEventId: "pi_batch_1" }),
      makeEvent({ sourceEventId: "pi_batch_2", eventType: "SUBSCRIPTION_RENEWAL", amount: 999 }),
      makeEvent({ sourceEventId: "pi_batch_3", eventType: "ONE_TIME_PAYMENT", amount: 4900 }),
    ];
    const summary = await ingestRevenueEvents(baseInput(events));

    expect(summary.receivedCount).toBe(3);
    expect(summary.insertedCount).toBe(3);
    expect(summary.skippedDuplicateCount).toBe(0);
  });

  it("persists the correct field values to the database", async () => {
    const event = makeEvent({ sourceEventId: "pi_field_check" });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });

    expect(record).not.toBeNull();
    expect(record!.source).toBe("STRIPE");
    expect(record!.sourceEventId).toBe("pi_field_check");
    expect(record!.eventType).toBe("SUBSCRIPTION_NEW");
    expect(record!.amount).toBe(2999);
    expect(record!.currency).toBe("USD");
    expect(record!.userId).toBe(userId);
  });
});

// ---------------------------------------------------------------------------
// Duplicate skipping
// ---------------------------------------------------------------------------

describe("duplicate idempotency key skipping", () => {
  it("skips an event with a duplicate idempotency key", async () => {
    const event = makeEvent({ sourceEventId: "pi_dup_001" });

    const first = await ingestRevenueEvents(baseInput([event]));
    expect(first.insertedCount).toBe(1);

    const second = await ingestRevenueEvents(baseInput([event]));
    expect(second.insertedCount).toBe(0);
    expect(second.skippedDuplicateCount).toBe(1);
    expect(second.receivedCount).toBe(1);
  });

  it("inserts new events while skipping duplicates in the same batch", async () => {
    const dup = makeEvent({ sourceEventId: "pi_dup_002" });
    await ingestRevenueEvents(baseInput([dup]));

    const newEvent = makeEvent({ sourceEventId: "pi_new_001" });
    const summary = await ingestRevenueEvents(baseInput([dup, newEvent]));

    expect(summary.receivedCount).toBe(2);
    expect(summary.insertedCount).toBe(1);
    expect(summary.skippedDuplicateCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// isPortfolioCurrency
// ---------------------------------------------------------------------------

describe("isPortfolioCurrency flag", () => {
  it("sets isPortfolioCurrency true when currency matches portfolio currency", async () => {
    const event = makeEvent({ sourceEventId: "pi_usd_match", currency: "USD" });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    expect(record!.isPortfolioCurrency).toBe(true);
  });

  it("sets isPortfolioCurrency false when currency differs from portfolio currency", async () => {
    const event = makeEvent({ sourceEventId: "pi_gbp_mismatch", currency: "GBP" });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    expect(record!.isPortfolioCurrency).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ExternalProduct discovery
// ---------------------------------------------------------------------------

describe("ExternalProduct record creation", () => {
  it("creates an ExternalProduct when a new externalProductId is seen", async () => {
    const event = makeEvent({
      sourceEventId: "pi_new_product",
      externalProductId: "price_new_abc",
    });
    const summary = await ingestRevenueEvents(baseInput([event]));

    expect(summary.discoveredExternalProductCount).toBe(1);

    const product = await db.externalProduct.findUnique({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId,
          externalProductId: "price_new_abc",
        },
      },
    });
    expect(product).not.toBeNull();
    expect(product!.appId).toBeNull();
  });

  it("does not increment discoveredCount for an already-known product", async () => {
    const event1 = makeEvent({
      sourceEventId: "pi_known_1",
      externalProductId: "price_known",
    });
    const event2 = makeEvent({
      sourceEventId: "pi_known_2",
      externalProductId: "price_known",
    });

    const first = await ingestRevenueEvents(baseInput([event1]));
    expect(first.discoveredExternalProductCount).toBe(1);

    const second = await ingestRevenueEvents(baseInput([event2]));
    expect(second.discoveredExternalProductCount).toBe(0);
  });

  it("discovers multiple distinct products in one batch", async () => {
    const events = [
      makeEvent({ sourceEventId: "pi_mp_1", externalProductId: "price_multi_a" }),
      makeEvent({ sourceEventId: "pi_mp_2", externalProductId: "price_multi_b" }),
      makeEvent({ sourceEventId: "pi_mp_3", externalProductId: "price_multi_a" }),
    ];
    const summary = await ingestRevenueEvents(baseInput(events));

    expect(summary.discoveredExternalProductCount).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// appId resolution
// ---------------------------------------------------------------------------

describe("appId assignment", () => {
  it("assigns appId when externalProductId is already mapped to an App", async () => {
    // Pre-create a mapped ExternalProduct
    await db.externalProduct.create({
      data: { dataSourceId, externalProductId: "price_mapped", appId },
    });

    const event = makeEvent({
      sourceEventId: "pi_mapped_app",
      externalProductId: "price_mapped",
    });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    expect(record!.appId).toBe(appId);
  });

  it("leaves appId null when externalProductId is unmapped", async () => {
    const event = makeEvent({
      sourceEventId: "pi_unmapped_app",
      externalProductId: "price_unmapped_xyz",
    });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    expect(record!.appId).toBeNull();
  });

  it("leaves appId null when no externalProductId is provided", async () => {
    const event = makeEvent({ sourceEventId: "pi_no_product" });
    await ingestRevenueEvents(baseInput([event]));

    const record = await db.normalizedRevenueEvent.findUnique({
      where: { idempotencyKey: event.idempotencyKey },
    });
    expect(record!.appId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Invalid event handling
// ---------------------------------------------------------------------------

describe("invalid event handling", () => {
  it("rejects invalid events without failing the batch", async () => {
    const valid = makeEvent({ sourceEventId: "pi_mixed_valid" });
    const invalid = makeEvent({
      sourceEventId: "",
      idempotencyKey: "",
      amount: 0,
      currency: "bad",
    });

    const summary = await ingestRevenueEvents(baseInput([valid, invalid]));

    expect(summary.receivedCount).toBe(2);
    expect(summary.insertedCount).toBe(1);
    expect(summary.invalidCount).toBe(1);
  });

  it("returns zero insertedCount when all events are invalid", async () => {
    const invalid = makeEvent({ amount: 0, currency: "x" });
    const summary = await ingestRevenueEvents(baseInput([invalid]));

    expect(summary.receivedCount).toBe(1);
    expect(summary.insertedCount).toBe(0);
    expect(summary.invalidCount).toBe(1);
  });

  it("handles an empty events array gracefully", async () => {
    const summary = await ingestRevenueEvents(baseInput([]));

    expect(summary.receivedCount).toBe(0);
    expect(summary.insertedCount).toBe(0);
    expect(summary.invalidCount).toBe(0);
    expect(summary.discoveredExternalProductCount).toBe(0);
  });
});
