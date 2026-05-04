import { describe, it, expect } from "vitest";
import { buildIdempotencyKey } from "../idempotency";
import { validateRevenueEventInput, isRefundEvent } from "../validation";
import type { NormalizedRevenueEventInput } from "../types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function stripeEvent(
  overrides: Partial<NormalizedRevenueEventInput> = {}
): NormalizedRevenueEventInput {
  return {
    source: "STRIPE",
    sourceEventId: "pi_test_abc123",
    idempotencyKey: "stripe:pi_test_abc123",
    eventType: "SUBSCRIPTION_NEW",
    occurredAt: new Date("2024-03-01T10:00:00Z"),
    amount: 2999,
    currency: "USD",
    ...overrides,
  };
}

function revenueCatEvent(
  overrides: Partial<NormalizedRevenueEventInput> = {}
): NormalizedRevenueEventInput {
  return {
    source: "REVENUECAT",
    sourceEventId: "txn_rc_xyz789",
    idempotencyKey: "revenuecat:txn_rc_xyz789",
    eventType: "SUBSCRIPTION_RENEWAL",
    occurredAt: new Date("2024-03-15T08:30:00Z"),
    amount: 999,
    currency: "USD",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

describe("buildIdempotencyKey", () => {
  it("formats a Stripe key correctly", () => {
    expect(buildIdempotencyKey("STRIPE", "pi_test_abc123")).toBe(
      "stripe:pi_test_abc123"
    );
  });

  it("formats a RevenueCat key correctly", () => {
    expect(buildIdempotencyKey("REVENUECAT", "txn_rc_xyz789")).toBe(
      "revenuecat:txn_rc_xyz789"
    );
  });

  it("preserves the sourceEventId exactly as provided", () => {
    expect(buildIdempotencyKey("STRIPE", "re_refund_456")).toBe(
      "stripe:re_refund_456"
    );
  });

  it("throws when sourceEventId is empty", () => {
    expect(() => buildIdempotencyKey("STRIPE", "")).toThrow(
      "sourceEventId is empty"
    );
  });
});

// ---------------------------------------------------------------------------
// Validation — valid inputs
// ---------------------------------------------------------------------------

describe("validateRevenueEventInput — valid inputs", () => {
  it("accepts a valid Stripe subscription event", () => {
    const result = validateRevenueEventInput(stripeEvent());
    expect(result.valid).toBe(true);
  });

  it("accepts a valid RevenueCat renewal event", () => {
    const result = validateRevenueEventInput(revenueCatEvent());
    expect(result.valid).toBe(true);
  });

  it("accepts a valid one-time payment event", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "ONE_TIME_PAYMENT", amount: 4900 })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts a valid refund event with negative amount", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "REFUND", amount: -2999 })
    );
    expect(result.valid).toBe(true);
  });

  it("accepts events with optional fields present", () => {
    const result = validateRevenueEventInput(
      stripeEvent({
        externalProductId: "price_pro_monthly",
        externalCustomerId: "cus_abc",
        rawPayload: { id: "pi_test_abc123" },
      })
    );
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation — refund amount
// ---------------------------------------------------------------------------

describe("validateRevenueEventInput — refund amount", () => {
  it("rejects a REFUND event with a positive amount", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "REFUND", amount: 2999 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("REFUND events must have a negative amount");
    }
  });

  it("rejects a REFUND event with zero amount", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "REFUND", amount: 0 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("non-zero"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation — positive revenue amount
// ---------------------------------------------------------------------------

describe("validateRevenueEventInput — positive revenue amount", () => {
  it("rejects a SUBSCRIPTION_NEW event with a negative amount", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "SUBSCRIPTION_NEW", amount: -500 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "SUBSCRIPTION_NEW events must have a positive amount"
      );
    }
  });

  it("rejects a SUBSCRIPTION_RENEWAL event with a negative amount", () => {
    const result = validateRevenueEventInput(
      revenueCatEvent({ eventType: "SUBSCRIPTION_RENEWAL", amount: -999 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "SUBSCRIPTION_RENEWAL events must have a positive amount"
      );
    }
  });

  it("rejects a ONE_TIME_PAYMENT event with zero amount", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ eventType: "ONE_TIME_PAYMENT", amount: 0 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("non-zero"))).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation — currency
// ---------------------------------------------------------------------------

describe("validateRevenueEventInput — currency", () => {
  it("rejects a lowercase currency code", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "usd" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((e) => e.includes("currency"))).toBe(true);
    }
  });

  it("rejects a mixed-case currency code", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "Usd" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a currency code that is too short", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "US" }));
    expect(result.valid).toBe(false);
  });

  it("rejects a currency code that is too long", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "USDD" }));
    expect(result.valid).toBe(false);
  });

  it("rejects an empty currency", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "" }));
    expect(result.valid).toBe(false);
  });

  it("accepts GBP as a valid currency", () => {
    const result = validateRevenueEventInput(stripeEvent({ currency: "GBP" }));
    expect(result.valid).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validation — missing required fields
// ---------------------------------------------------------------------------

describe("validateRevenueEventInput — missing required fields", () => {
  it("rejects an empty sourceEventId", () => {
    const result = validateRevenueEventInput(stripeEvent({ sourceEventId: "" }));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "sourceEventId must be a non-empty string"
      );
    }
  });

  it("rejects an empty idempotencyKey", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ idempotencyKey: "" })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain(
        "idempotencyKey must be a non-empty string"
      );
    }
  });

  it("rejects an invalid occurredAt date", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ occurredAt: new Date("not-a-date") })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain("occurredAt must be a valid Date");
    }
  });

  it("collects multiple errors at once", () => {
    const result = validateRevenueEventInput(
      stripeEvent({ sourceEventId: "", currency: "usd", amount: 0 })
    );
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("isRefundEvent", () => {
  it("returns true for a REFUND event", () => {
    expect(isRefundEvent(stripeEvent({ eventType: "REFUND", amount: -500 }))).toBe(true);
  });

  it("returns false for a non-REFUND event", () => {
    expect(isRefundEvent(stripeEvent({ eventType: "SUBSCRIPTION_NEW" }))).toBe(false);
    expect(isRefundEvent(revenueCatEvent({ eventType: "SUBSCRIPTION_RENEWAL" }))).toBe(false);
    expect(isRefundEvent(stripeEvent({ eventType: "ONE_TIME_PAYMENT" }))).toBe(false);
  });
});
