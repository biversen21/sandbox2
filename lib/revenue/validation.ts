import type { NormalizedRevenueEventInput } from "./types";

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: string[] };

const CURRENCY_RE = /^[A-Z]{3}$/;

export function validateRevenueEventInput(
  input: NormalizedRevenueEventInput
): ValidationResult {
  const errors: string[] = [];

  if (!input.sourceEventId) {
    errors.push("sourceEventId must be a non-empty string");
  }

  if (!input.idempotencyKey) {
    errors.push("idempotencyKey must be a non-empty string");
  }

  if (input.amount === 0) {
    errors.push("amount must be non-zero");
  }

  if (!CURRENCY_RE.test(input.currency)) {
    errors.push(
      `currency must be a 3-character uppercase ISO 4217 code (received "${input.currency}")`
    );
  }

  if (!(input.occurredAt instanceof Date) || isNaN(input.occurredAt.getTime())) {
    errors.push("occurredAt must be a valid Date");
  }

  if (input.eventType === "REFUND" && input.amount > 0) {
    errors.push("REFUND events must have a negative amount");
  }

  if (input.eventType !== "REFUND" && input.amount < 0) {
    errors.push(`${input.eventType} events must have a positive amount`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true };
}

export function isRefundEvent(input: NormalizedRevenueEventInput): boolean {
  return input.eventType === "REFUND";
}
