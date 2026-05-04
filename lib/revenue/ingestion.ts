import { db } from "@/lib/db";
import {
  Prisma,
  RevenueSource,
  RevenueEventType,
} from "@/app/generated/prisma/client";
import { validateRevenueEventInput } from "./validation";
import type { NormalizedRevenueEventInput } from "./types";

export interface IngestionInput {
  userId: string;
  dataSourceId: string;
  portfolioCurrency: string;
  events: NormalizedRevenueEventInput[];
}

export interface IngestionSummary {
  receivedCount: number;
  insertedCount: number;
  skippedDuplicateCount: number;
  invalidCount: number;
  discoveredExternalProductCount: number;
}

export async function ingestRevenueEvents(
  input: IngestionInput
): Promise<IngestionSummary> {
  const { userId, dataSourceId, portfolioCurrency, events } = input;

  // --- 1. Validate all events ------------------------------------------------
  const valid: NormalizedRevenueEventInput[] = [];
  let invalidCount = 0;

  for (const event of events) {
    const result = validateRevenueEventInput(event);
    if (result.valid) {
      valid.push(event);
    } else {
      invalidCount++;
    }
  }

  // --- 2. Resolve ExternalProducts -------------------------------------------
  const sourceProductIds = [
    ...new Set(
      valid
        .filter((e) => e.externalProductId)
        .map((e) => e.externalProductId!)
    ),
  ];

  let discoveredExternalProductCount = 0;
  // Maps sourceProductId -> appId (null if unmapped)
  const productAppIdMap = new Map<string, string | null>();

  if (sourceProductIds.length > 0) {
    const existing = await db.externalProduct.findMany({
      where: { dataSourceId, externalProductId: { in: sourceProductIds } },
      select: { externalProductId: true, appId: true },
    });

    const existingIds = new Set(existing.map((p) => p.externalProductId));
    for (const p of existing) {
      productAppIdMap.set(p.externalProductId, p.appId);
    }

    const newIds = sourceProductIds.filter((id) => !existingIds.has(id));
    if (newIds.length > 0) {
      await db.externalProduct.createMany({
        data: newIds.map((id) => ({ dataSourceId, externalProductId: id })),
        skipDuplicates: true,
      });
      discoveredExternalProductCount = newIds.length;
      for (const id of newIds) {
        productAppIdMap.set(id, null);
      }
    }
  }

  // --- 3. Insert events -------------------------------------------------------
  if (valid.length === 0) {
    return {
      receivedCount: events.length,
      insertedCount: 0,
      skippedDuplicateCount: 0,
      invalidCount,
      discoveredExternalProductCount,
    };
  }

  const eventData = valid.map((event) => ({
    idempotencyKey: event.idempotencyKey,
    userId,
    source: event.source as RevenueSource,
    sourceEventId: event.sourceEventId,
    eventType: event.eventType as RevenueEventType,
    occurredAt: event.occurredAt,
    amount: event.amount,
    currency: event.currency,
    isPortfolioCurrency: event.currency === portfolioCurrency,
    sourceProductId: event.externalProductId ?? null,
    externalCustomerId: event.externalCustomerId ?? null,
    appId: event.externalProductId
      ? (productAppIdMap.get(event.externalProductId) ?? null)
      : null,
    rawPayload:
      event.rawPayload != null
        ? (event.rawPayload as Prisma.InputJsonValue)
        : Prisma.DbNull,
  }));

  const result = await db.normalizedRevenueEvent.createMany({
    data: eventData,
    skipDuplicates: true,
  });

  return {
    receivedCount: events.length,
    insertedCount: result.count,
    skippedDuplicateCount: valid.length - result.count,
    invalidCount,
    discoveredExternalProductCount,
  };
}
