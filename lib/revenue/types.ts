export type RevenueSource = "STRIPE" | "REVENUECAT";

export type RevenueEventType =
  | "SUBSCRIPTION_NEW"
  | "SUBSCRIPTION_RENEWAL"
  | "ONE_TIME_PAYMENT"
  | "REFUND";

export interface NormalizedRevenueEventInput {
  source: RevenueSource;
  sourceEventId: string;
  idempotencyKey: string;
  eventType: RevenueEventType;
  occurredAt: Date;
  /** Signed integer in smallest currency unit (e.g. cents). Negative for REFUND. */
  amount: number;
  /** ISO 4217 currency code, uppercase (e.g. "USD"). */
  currency: string;
  externalProductId?: string;
  externalCustomerId?: string;
  rawPayload?: unknown;
}

/** Contract every revenue source adapter must satisfy. */
export interface RevenueAdapter {
  readonly source: RevenueSource;
  fetchEvents(userId: string, since: Date): Promise<NormalizedRevenueEventInput[]>;
}
