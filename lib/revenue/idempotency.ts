import type { RevenueSource } from "./types";

const SOURCE_PREFIX: Record<RevenueSource, string> = {
  STRIPE: "stripe",
  REVENUECAT: "revenuecat",
};

/**
 * Builds a deterministic idempotency key for a revenue event.
 * Format: {source_prefix}:{sourceEventId}
 * Examples: stripe:pi_abc123, revenuecat:txn_xyz789
 */
export function buildIdempotencyKey(
  source: RevenueSource,
  sourceEventId: string
): string {
  if (!sourceEventId) {
    throw new Error(
      `Cannot build idempotency key: sourceEventId is empty for source ${source}`
    );
  }
  return `${SOURCE_PREFIX[source]}:${sourceEventId}`;
}
