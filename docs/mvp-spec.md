# Revenue Insight Engine — MVP Technical Specification

---

## 1. Product Summary

A single-user, web-based decision engine for indie builders who generate revenue
across multiple apps and sources. The product connects to Stripe and RevenueCat,
normalizes revenue data into a shared model, aggregates it by app, and generates
deterministic, rule-based insights that answer three questions for each app:
what is happening, why it matters, and what to do next.

This is not a reporting dashboard. It does not produce charts. It produces
prioritized, actionable recommendations.

---

## 2. MVP Constraints

- Single user. No authentication system beyond a single account. No teams, orgs, or shared access.
- Pull-based sync only. No webhooks. User triggers sync manually.
- Initial sync window: 90 days back from sync date.
- Revenue sources: Stripe and RevenueCat only.
- Portfolio currency: USD (user-configurable in settings). No live FX conversion.
- Insight generation: deterministic, rule-based only. No LLM.
- Insights generated on demand after each sync.
- Apps are user-defined. No automatic product-to-app detection.
- Unmapped revenue is stored but never included in app-level insights.

---

## 3. Core Architecture

The system is organized into six distinct layers. Each layer has a single
responsibility and a defined input/output contract. No layer reaches past its neighbor.

**Adapter Layer**
Stripe Adapter and RevenueCat Adapter. Responsibility: fetch raw events from
external APIs, translate to NormalizedRevenueEvent. Knows nothing about apps,
insights, or scores.

**Ingestion Layer**
Responsibility: receive NormalizedRevenueEvents from adapters, deduplicate via
idempotency key, persist to the events table, set `is_portfolio_currency` flag
at write time.

**Mapping Layer**
Responsibility: maintain the relationship between external product IDs and
internal App records. Runs after ingestion to stamp `app_id` onto events.
Unmapped events remain in storage with `app_id = null`.

**Aggregation Layer**
Responsibility: read NormalizedRevenueEvents and produce DailyAppRevenue records.
Runs after mapping. Aggregates by `app_id` and `date`. Excludes
non-portfolio-currency events from normalized revenue totals but tracks their
count and raw sum separately.

**Insight Engine**
Responsibility: read DailyAppRevenue records only. Compute per-app metrics,
scores, and classifications. Produce AppInsight records and one PortfolioInsight
record. Never touches raw events.

**Presentation Layer**
Responsibility: serve the web interface. Read from persisted insight records.
Does not compute anything. Displays observations, interpretations,
recommendations, and data quality warnings.

---

## 4. Data Flow

```
User triggers sync
  → Stripe Adapter fetches last N days of charges, invoice payments, refunds
  → RevenueCat Adapter fetches last N days of transactions
  → Both emit NormalizedRevenueEvents
  → Ingestion Layer deduplicates and persists events
  → Mapping Layer stamps app_id on events where external_product_id is mapped
  → Aggregation Layer recomputes DailyAppRevenue for affected date range and apps
  → Insight Engine reads DailyAppRevenue, computes metrics, writes AppInsights
    and PortfolioInsight
  → User views updated insights in the presentation layer
```

Sync is atomic per source. If the Stripe sync succeeds and RevenueCat fails,
Stripe data is persisted and the user is notified of the partial failure.
Insight generation only runs if at least one source synced successfully.

---

## 5. NormalizedRevenueEvent Contract

This is the shared output contract all adapters must produce. The insight engine
never reads this table.

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | UUID | Yes | Internal primary key |
| `idempotency_key` | string | Yes | Unique. Format: `{source}:{source_id}` |
| `source` | enum | Yes | `STRIPE` \| `REVENUECAT` |
| `source_event_id` | string | Yes | Raw ID from source system |
| `event_type` | enum | Yes | See below |
| `occurred_at` | timestamp UTC | Yes | From source, not ingest time |
| `ingested_at` | timestamp UTC | Yes | Set at write time |
| `amount` | integer | Yes | Signed, smallest currency unit (e.g. cents). Positive for revenue, negative for refunds. |
| `currency` | string | Yes | ISO 4217 (e.g. `USD`, `GBP`) |
| `is_portfolio_currency` | boolean | Yes | Set at ingest time |
| `external_product_id` | string | No | Stripe price/product ID or RevenueCat product identifier |
| `external_customer_id` | string | No | For future use |
| `app_id` | UUID | No | Null until mapped |
| `raw_payload` | JSONB | No | Full source response |

### event_type Enum

| Value | When to use |
|---|---|
| `SUBSCRIPTION_NEW` | First payment on a new subscription |
| `SUBSCRIPTION_RENEWAL` | Subsequent recurring subscription payment |
| `ONE_TIME_PAYMENT` | Non-subscription charge or purchase |
| `REFUND` | Negative revenue event. Amount is always negative. |

### Idempotency Key Format

```
stripe:{payment_intent_id}     charges and invoice payments
stripe:{refund_id}             refunds (re_xxx)
revenuecat:{transaction_id}    all RevenueCat transactions
```

If no stable unique ID is available from a source, the adapter constructs a
deterministic key from: `{source}:{customer_id}:{product_id}:{amount}:{occurred_at}`.
This fallback must be documented per adapter.

The database enforces uniqueness on `idempotency_key`. Adapters use
insert-or-ignore on conflict. Re-syncing the same window is safe.

### Source-Specific Normalization Rules

**Stripe:**
- Include: successful charges, paid invoice payments (subscription and one-time)
- Exclude: failed payments, disputes (unless they appear as negative balance events)
- Refunds: represent as `REFUND` events with negative amount when available

**RevenueCat:**
- Include: `initial_purchase`, `renewal`, `non_subscription_purchase` event types
- Exclude: trials with zero revenue, free trials
- Refunds: represent as `REFUND` events only if the API returns them as
  revenue-impacting transactions. Absence of refund events from RevenueCat does
  not imply no refunds occurred — this asymmetry must be documented at the
  adapter boundary.

---

## 6. Daily Aggregation Contract

The DailyAppRevenue table is the exclusive input to the insight engine.

| Field | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key |
| `app_id` | UUID | Foreign key to App |
| `date` | date | UTC date |
| `gross_revenue` | integer | SUM(amount) for non-refund events WHERE is_portfolio_currency = true |
| `refunds` | integer | SUM(amount) for REFUND events WHERE is_portfolio_currency = true (zero or negative) |
| `net_revenue` | integer | gross_revenue + refunds |
| `new_subscription_revenue` | integer | SUM for SUBSCRIPTION_NEW |
| `renewal_revenue` | integer | SUM for SUBSCRIPTION_RENEWAL |
| `one_time_revenue` | integer | SUM for ONE_TIME_PAYMENT |
| `excluded_currency_event_count` | integer | COUNT WHERE is_portfolio_currency = false |
| `excluded_currency_gross` | integer | SUM(amount) WHERE is_portfolio_currency = false (original currency, informational only) |

Unique constraint on `(app_id, date)`. Recomputed on upsert whenever underlying
events change for that app and date.

A separate `PortfolioDailyRevenue` table aggregates across all mapped apps:
`date`, `total_net_revenue`, `total_gross_revenue`, `total_refunds`. Used to
compute `portfolio_share` and `revenue_impact` metrics at insight time.

---

## 7. Product/App Mapping Rules

- An App is a user-created internal record with a name and optional description.
- An ExternalProduct record stores: `source`, `external_product_id`,
  `display_name`, and `app_id` (nullable).
- External products are discovered during sync. Any `external_product_id` seen
  in a NormalizedRevenueEvent that has no ExternalProduct record is created
  automatically with `app_id = null`.
- The user maps ExternalProducts to Apps in the mapping interface.
- One ExternalProduct maps to exactly one App.
- One App can have many ExternalProducts.
- When a mapping is created or changed, the aggregation layer recomputes
  DailyAppRevenue for all affected `app_id`s across the full stored event
  history (not just the last 90 days).
- Events with `app_id = null` are stored and synced normally but excluded from
  DailyAppRevenue computation.
- The total unmapped revenue in the last 7 days is tracked for portfolio-level
  warnings.

---

## 8. Currency Handling Rules

- Portfolio currency is a single user-level setting, defaulting to USD.
- `is_portfolio_currency` is set at ingestion time by comparing the event
  currency to the user's portfolio currency setting.
- Non-portfolio-currency events are stored with their original currency and
  amount but excluded from all normalized revenue totals in DailyAppRevenue
  and from all insight calculations.
- If any non-portfolio-currency events exist in the last 28 days, a data
  quality warning is generated:
  > "Some revenue events are in a non-portfolio currency and have been excluded
  > from insights. Consider reviewing your portfolio currency setting."
- The warning includes the count of excluded events and the sum per currency
  (in the original currency, no conversion).
- No FX conversion is performed at any layer.
- If the user changes their portfolio currency setting, all events must have
  `is_portfolio_currency` recomputed and DailyAppRevenue must be fully recomputed.

---

## 9. Insight Engine Inputs

The insight engine receives, per run, the following inputs for each mapped app:

- DailyAppRevenue rows for the last 28 days (days -28 to -1)
- PortfolioDailyRevenue rows for the same window
- App metadata (id, name)
- Portfolio currency

From these inputs it computes per app:

| Metric | Definition |
|---|---|
| `current_7d_revenue` | SUM(net_revenue) for days -7 to -1 |
| `previous_7d_revenue` | SUM(net_revenue) for days -14 to -8 |
| `absolute_delta_7d` | current_7d_revenue - previous_7d_revenue |
| `growth_rate_7d` | absolute_delta_7d / previous_7d_revenue (null if previous = 0) |
| `portfolio_share_7d` | current_7d_revenue / total_portfolio_7d_revenue |
| `revenue_impact_share` | abs(absolute_delta_7d) / total_portfolio_7d_revenue |
| `last_14d_revenue` | SUM(net_revenue) for days -14 to -1 |
| `prior_14d_revenue` | SUM(net_revenue) for days -28 to -15 |
| `trend_28d` | UP if last_14d > prior_14d × 1.05 / DOWN if last_14d < prior_14d × 0.95 / FLAT otherwise |
| `refunds_7d` | SUM(refunds) for days -7 to -1 (zero or negative) |
| `is_refund_driven` | true if abs(refunds_7d) / abs(absolute_delta_7d) > 0.50, only when delta < 0 |

`total_portfolio_7d_revenue` is the SUM of `current_7d_revenue` across all apps
with mapped revenue.

Unmapped revenue total (7d) is computed separately from `PortfolioDailyRevenue`
minus the sum of all mapped DailyAppRevenue for the same window.

---

## 10. Insight Scoring Formulas

### Opportunity Score

```
opportunity_score = revenue_impact_share × (1 + min(growth_rate_7d, 2.0))
```

Eligible when:
- `absolute_delta_7d > 0`
- `growth_rate_7d >= 0.10`

### Risk Score

```
trend_multiplier = 1.25 if trend_28d = DOWN, else 1.0

risk_score = revenue_impact_share × (1 + min(abs(growth_rate_7d), 2.0)) × trend_multiplier
```

Eligible when:
- `absolute_delta_7d < 0`
- `growth_rate_7d <= -0.10`

When `is_refund_driven = true`: score is unchanged. The recommendation template
switches from "revenue declining" to "investigate refund spike."

Both scores are computed for all eligible apps regardless of type. The engine
selects the single highest-scoring app across both lists as the top recommendation.

---

## 11. Classification Rules

Each app receives exactly one classification. Rules are evaluated in order:
first match wins.

| Classification | Condition |
|---|---|
| `INSUFFICIENT_DATA` | Fewer than 14 days of revenue data in the 28-day window |
| `AT_RISK` | growth_rate_7d <= -0.20 AND revenue_impact_share >= 0.05 |
| `DECLINING` | growth_rate_7d <= -0.10 AND trend_28d = DOWN |
| `SLIPPING` | growth_rate_7d <= -0.10 AND trend_28d != DOWN |
| `STABLE` | abs(growth_rate_7d) < 0.10 |
| `GROWING` | growth_rate_7d >= 0.10 AND trend_28d = UP |
| `RECOVERING` | growth_rate_7d >= 0.10 AND trend_28d != UP |

`GROWING` requires a confirming 28-day trend. A single good week without a
confirming trend is `RECOVERING`. This distinction affects recommendation
template language.

---

## 12. Top Recommendation Rules

### Eligibility Thresholds (all must pass)

```
current_7d_revenue >= $50 (portfolio currency)
portfolio_share_7d >= 0.05
revenue_impact_share >= 0.03
```

Apps that fail any threshold are classified and displayed but are ineligible
for the top recommendation slot.

### Selection

1. Compute `opportunity_score` for all eligible opportunity-qualifying apps.
2. Compute `risk_score` for all eligible risk-qualifying apps.
3. Combine both lists. Select the app with the highest score regardless of type.
4. Top recommendation type is `OPPORTUNITY` or `RISK` based on which list the winner came from.

### Tie-Breaking (when two scores are within 5% of each other)

1. Higher `revenue_impact_share` wins.
2. If still tied: higher `portfolio_share_7d` wins.
3. If still tied: app with confirming trend wins (`UP` for opportunities, `DOWN` for risks).
4. If still tied: higher `current_7d_revenue` wins.

### No Recommendation

If no app passes all eligibility thresholds, the engine emits no top
recommendation and surfaces a portfolio note:
> "No app currently has enough revenue signal to generate a top recommendation."

### Insight Output Structure

Each `AppInsight` record contains:

| Field | Type |
|---|---|
| `app_id` | UUID |
| `generated_at` | timestamp |
| `classification` | enum |
| `opportunity_score` | float, nullable |
| `risk_score` | float, nullable |
| `is_top_recommendation` | boolean |
| `recommendation_type` | `OPPORTUNITY` \| `RISK` \| null |
| `is_refund_driven` | boolean |
| `observation` | string |
| `interpretation` | string |
| `recommendation` | string |

Each `PortfolioInsight` record contains:

| Field | Type |
|---|---|
| `generated_at` | timestamp |
| `top_recommendation_app_id` | UUID, nullable |
| `top_recommendation_type` | `OPPORTUNITY` \| `RISK` \| null |
| `total_7d_net_revenue` | integer |
| `total_28d_net_revenue` | integer |
| `unmapped_revenue_7d` | integer |
| `has_unmapped_revenue` | boolean |
| `has_currency_warning` | boolean |
| `currency_warning_detail` | string, nullable |

---

## 13. Expected MVP Pages/Screens

Five pages. No charts. Text and structured data only.

### Page 1: Portfolio (default landing page)
- Top recommendation card: type badge, app name, observation, interpretation, recommendation
- App list: each row shows app name, classification badge, `current_7d_revenue`, `absolute_delta_7d`, `growth_rate_7d`
- Data quality warnings: unmapped revenue banner, currency warning banner
- Last synced timestamp, sync button

### Page 2: App Detail
- App name, classification badge
- Key metrics: `current_7d_revenue`, `previous_7d_revenue`, `absolute_delta_7d`, `growth_rate_7d`, `portfolio_share_7d`, `trend_28d`
- Revenue breakdown: new subscription, renewal, one-time, refunds (7d)
- Full insight: observation, interpretation, recommendation
- Refund-driven flag if applicable

### Page 3: Connect Sources
- Stripe: API key input, connection status, last synced, sync button
- RevenueCat: API key input, connection status, last synced, sync button
- Per-source sync error display if partial failure occurred

### Page 4: Map Products
- Internal apps list: create, rename, delete
- Unmapped external products list (discovered during sync): source badge, external product name/ID, dropdown to assign to an App
- Mapped products list per app: source and external product name

### Page 5: Settings
- Portfolio currency selector (USD default)
- Warning displayed if changing currency will recompute all historical aggregations

---

## 14. Test Strategy

### Unit Tests (no database, no network)

**Adapter normalization**
Given a mock Stripe API response, assert correct NormalizedRevenueEvent fields,
`event_type`, amount sign, and `idempotency_key` format. Same for RevenueCat.
Test edge cases: refunds, zero-revenue trials (excluded), failed charges (excluded).

**Idempotency key construction**
Given source + source_event_id combinations, assert correct key format. Assert
fallback key construction for missing IDs.

**Aggregation logic**
Given a set of NormalizedRevenueEvents with known amounts and dates, assert
correct DailyAppRevenue field values. Test currency exclusion: non-portfolio-
currency events excluded from normalized totals, counted in
`excluded_currency_event_count`.

**Metric computation**
Given a DailyAppRevenue series, assert correct values for all computed metrics.
Test null handling for `growth_rate_7d` when `previous_7d_revenue = 0`.

**Scoring formulas**
Given known metric values, assert correct `opportunity_score` and `risk_score`.
Test growth_rate cap at 2.0. Test `trend_multiplier` application. Test
`is_refund_driven` threshold at 50%.

**Classification rules**
Given known metric values, assert correct classification. Test all boundary
conditions.

**Eligibility thresholds**
Given apps at, above, and below each threshold, assert correct eligibility.
Assert that a failing app is classified but not recommended.

**Tie-breaking**
Given two apps within 5% of each other on score, assert correct winner at each
tie-break level.

**Top recommendation selection**
Given a mixed set of opportunity and risk eligible apps, assert the
highest scorer across both lists is selected. Assert a risk can outrank an
opportunity. Assert no recommendation is emitted when no app is eligible.

### Integration Tests (database required, no network)

- Full sync flow: given seeded mock API responses, assert events, aggregations,
  and insights are correctly persisted and consistent.
- Mapping recomputation: given unmapped then mapped events, assert DailyAppRevenue
  recomputes correctly after mapping.
- Currency recomputation: changing portfolio currency recomputes
  `is_portfolio_currency` and DailyAppRevenue correctly.

No E2E tests in MVP.

The insight engine must be a pure function of its inputs — testable by injecting
a DailyAppRevenue series directly without requiring a database or sync.

---

## 15. Explicit Non-Goals

The following are explicitly out of scope for MVP and must not be designed for,
hinted at, or partially implemented:

- Charts, graphs, or any data visualization
- LLM-generated or AI-generated insights
- Webhook-based or real-time sync
- Scheduled sync (manual only)
- Multi-user support, teams, organizations, or role-based access
- Live foreign exchange conversion
- Alerts or threshold-based notifications
- Experiment tracking or A/B test analysis
- Any revenue source beyond Stripe and RevenueCat
- Export (CSV, PDF, or otherwise)
- Public-facing links or shared insight views
- Trend charts or sparklines
- Historical drill-down beyond the 28-day insight window
- Cohort analysis
- Customer-level revenue analysis
- Revenue forecasting
- Audit logs
- API access for external consumers
