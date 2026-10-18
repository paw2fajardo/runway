# Runway AI features report

Date: October 18, 2026. Status: implemented and verified locally. This report records verification before PR delivery. This Insights page update has not been deployed.

## Features delivered

| Feature | Where | Behavior |
| --- | --- | --- |
| Bill payment planner | Insights | Compares 45 days of current payments, spending cuts, eligible grace periods, and combined options. Shows payment dates, lowest daily balances, and shortfalls. Grace periods require opt-in. Autopay dates stay fixed. Optional AI explains server-calculated results. |
| Plain-language logging | Insights, **Describe a payment** | Simple expense sentences work locally. Other text uses the existing AI parser when configured. Entries stay in the inbox until reviewed. Review supports amount, additional fee, account, category, description, payment time, and an optional bill link. Unknown categories stay unclassified. |
| Weekly spending review | Insights | Compares the last seven calendar days, including today, with the preceding seven days. Shows category changes, unclassified purchases, and unexplained balance decreases separately. Optional AI suggests up to three improvements using recorded evidence. |
| Forecast changes | Insights | Saves one server-generated baseline and compares cash, bills, budgets, planned spending, buffer, payday, overlapping daily balances, and named bill amounts, dates, and statuses. Replacing the baseline is explicit. |
| Purchase timing | Insights | Recalculates the full daily forecast for buying today versus on the next scheduled payday. Includes bills, budgets, spending, and income. Hypothetical purchases never enter the ledger. |
| Recurring charges and possible duplicates | Insights | Flags regularly spaced charges with at least three observations on the same account, latest increases against the previous median, and possible duplicate entries within 15 minutes. Candidates require review. |
| Variable bill estimates | Insights | Uses up to six paid occurrences to show a median estimate and historical range. Requires at least three payments. Leaves saved bill amounts and forecasts unchanged. |
| Reconciliation evidence | Insights | Compares the latest unexplained checkpoint difference with dated pending inbox evidence from the same account, matching direction and exact amount. Never invents or posts missing purchases. |

Insights is the home for AI questions, payment entry, spending explanations, and payment planning. The dashboard and bottom navigation link to Insights. Staged payment entries link to Inbox for review.

## Ledger and security behavior

- Parsing stages an entry; it does not move money. Account hints must match existing accounts. The parser no longer chooses a bank account when none is known.
- Category suggestions use existing categories or at least two consistent historical entries for the same normalized description.
- Review requires valid amounts, active accounts, valid categories, and a payment timestamp. Income credits the receiving account. Credit expenses increase outstanding debt.
- Fees are additional to principal. Transfers debit principal plus fees and credit principal to the destination.
- Approval locks the inbox row and affected accounts. Concurrent approval records the entry once. Reviewed corrections persist in the approved inbox record.
- Possible duplicates require an explicit confirmation after checking History. Payments dated at or before an affected account's latest checkpoint are rejected to avoid debiting reconciled balances again.
- Optional bill linking reuses bill posting, settles the occurrence once, and preserves recurrence. Separate fees must be recorded separately for linked bills.
- AI calls stay on the server and retain rate limits. Input and model output are validated. Names and descriptions remain untrusted data. AI explanations render as plain text.

## Verification

Final full-suite result: **474 passed, 2 failed, 0 skipped**, with the PostgreSQL test URL pointing to a disposable local container.

The two failures were also reproduced on the original HEAD earlier in this session:

1. `bill CRUD > updates recurring fields and moves only unpaid instances while preserving paid history`: expects three update calls; the existing code makes four.
2. `owner-protected runway routes > preserves the authenticated income stream list payload`: expects October 15 as the next payday; the existing code returns November 15 after that date.

New PostgreSQL integration coverage includes the actual migration, singleton constraint, authenticated APIs, staging without a debit, concurrent approval, fees, transfers, income, credit balances, duplicate confirmation, reconciliation protection, bill linking, baseline replacement, and purchase previews. The PostgreSQL constraint test observed the expected `23514` rejection for a second baseline key.

New SQLite integration tests passed for JSON baseline persistence, replacement, reviewed expense approval, duplicate approval rejection, and analytics. Existing SQLite integration tests also passed.

Browser checks passed against the disposable PostgreSQL database at desktop 1280 × 1000 and mobile 375 × 900:

- Dashboard discovery and Insights loading.
- Weekly review, recurring charges, possible duplicates, bill estimates, and reconciliation evidence.
- Baseline persistence and a cash difference after an actual reviewed entry.
- Purchase scenario selection without changing account balances.
- Plain-language staging, editing, confirmation, one debit, and approved state after reload.
- Missing-AI-key error and insights retry behavior.
- AI questions, payment capture, and bill planning on Insights; staged payment remained available in Inbox after navigation. Six navigation links fit at 375 px without horizontal overflow.
- No horizontal overflow or browser exceptions.

The earlier planner browser pass also checked grace opt-in, scenario selection, retry, unchanged saved bills and balances, guest rejection, and escaped simulated AI output. The Impeccable detector reported no findings on the new interfaces. Diff checks passed with CRLF-aware whitespace handling.

Type checking still reports the same six pre-existing errors in `tests/auth/protected-money-routes.test.ts` and `tests/ntfy.test.ts`. They were reproduced against the original HEAD. Lint requires the repository's initial ESLint configuration and was not completed. `npm run build` passed; browser checks used a disposable SQLite database and local Next.js server.

## Migration and deployment

**Apply migration 0021 before deploying this version:** `src/db/migrations/0021_forecast_baseline.sql`.

It creates `forecast_baselines`, a singleton JSONB baseline with a save timestamp. It does not rewrite ledger data. The real SQL migration was tested in a disposable PostgreSQL schema. Local SQLite uses the existing `npm run db:push` workflow; its equivalent schema was exercised in memory.

The existing `OPENROUTER_API_KEY` enables AI explanations and free-form parsing. Parsing also retains its existing `AI_API_KEY` fallback. No provider or dependency was added. No production database or deployment was changed. Commit and PR delivery are tracked separately from this verification report.

## Limits

- Live model generation was not tested. Missing-key behavior and simulated responses were tested; real model quality remains unverified.
- Bank API integration remains outside this change, as requested. Receipt capture was not added.
- Weekly reviews are available on demand; no scheduled notification was added.
- Transaction analysis uses 180 days, capped at 10,000 transactions. Checkpoint and pending-evidence limits are disclosed when reached. Unlogged spending remains unknown.
- Recurring charges are candidates, not confirmed subscriptions. Bill ranges describe past payments and do not guarantee future amounts.
- Reconciliation matches individual evidence amounts; it does not search combinations or automatically reclassify balancing adjustments.
- Forecast comparisons describe recorded differences. Changing forecast windows can change totals without new spending. Older baselines without bill inputs cannot show named bill changes until replaced.
- Forecasts pool liquid accounts and use daily closing balances. Same-day income timing and the paying account's available funds still need checking.
- Grace periods do not prove fee-free payment or continued service. The planner leaves one calendar day before the configured grace end; actual payment processing may require longer.

Verification servers and the disposable PostgreSQL container are removed after testing. Production remains unchanged.
