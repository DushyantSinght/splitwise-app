# DECISIONS.md — Decision Log

Each entry covers: the decision, options considered, what was chosen, and why.

---

## D01 — Tech Stack

**Decision:** Node.js + Express backend, React + Vite frontend, PostgreSQL database

**Options considered:**
1. MERN (MongoDB) — familiar, but assignment mandates relational DB
2. Node/Express + PostgreSQL — relational, SQL joins are natural for balance queries
3. Spring Boot + PostgreSQL — more enterprise, but slower to scaffold for a 2-day build
4. Next.js full-stack — blurs frontend/backend boundary, harder to deploy split services

**Chosen:** Option 2 — Node/Express + PostgreSQL + React

**Rationale:** PostgreSQL's relational model is the right fit: temporal membership (join/leave dates), expense splits, and balance aggregation all benefit from SQL JOINs and GROUP BY. Express is fast to scaffold. React gives component-level isolation for the import report UI, which is complex.

---

## D02 — Temporal Membership Model

**Decision:** Store `joined_at` and `left_at` on `group_members`, not just a boolean `is_active`

**Options considered:**
1. Boolean `is_active` flag on group_members — simple, but loses history
2. `joined_at` + `left_at` date columns — allows point-in-time queries
3. A separate `membership_events` audit table — most flexible, most complex

**Chosen:** Option 2 — `joined_at` + `left_at`

**Rationale:** Sam's requirement — "I moved in mid-April, why would March electricity affect my balance?" — requires knowing exactly when each person was a member. With `left_at`, we can check `expense_date BETWEEN joined_at AND COALESCE(left_at, 'infinity')` to determine active membership at any point in time. Option 1 would lose this history permanently.

---

## D03 — Balance Calculation: Store vs Compute

**Decision:** Compute balances on-the-fly from `expenses` and `expense_splits`, not store a running balance

**Options considered:**
1. Store a `balance` column per user and update it on every expense mutation — fast reads, dangerous writes (race conditions, drift)
2. Compute from source tables on every request — always accurate, slightly slower

**Chosen:** Option 2 — compute on request

**Rationale:** With ~40 rows, performance is not a concern. Computed balances are always consistent with the source data. A stored balance can drift if a bug in the update path is ever introduced, or if a row is soft-deleted. For an audit-sensitive app (the assignment literally mentions tracing every expense), correctness beats performance.

---

## D04 — Minimize Transactions Algorithm

**Decision:** Use the greedy "minimize transactions" algorithm to produce the settlement suggestions

**Options considered:**
1. Show raw pairwise debts (A owes B X, A owes C Y, etc.) — more transparent but more payments
2. Greedy minimize: sort creditors and debtors, match largest first — minimises number of transactions
3. Optimal minimize (NP-hard in general) — unnecessary for groups of ≤ 10

**Chosen:** Option 2 — greedy minimize

**Rationale:** Aisha's requirement is "one number per person, who pays whom, done." She does not want a matrix of pairwise debts. The greedy algorithm is O(n log n), correct for small groups, and produces the minimum number of transactions in practice. It is also easy to explain and trace line-by-line in a live session.

---

## D05 — USD Conversion Strategy

**Decision:** Convert USD to INR at a snapshot rate stored at import time

**Options considered:**
1. Live rate via API on every balance query — accurate but variable; balances change daily
2. Snapshot rate at import time — stored alongside each expense; balances are stable and auditable
3. Always store USD and let user set a rate in settings — most flexible, most UI complexity

**Chosen:** Option 2 — snapshot rate at import time

**Rationale:** Priya's complaint is that "the sheet pretends a dollar is a rupee." The fix is to apply a real exchange rate. But if the rate changes every day, Rohan can't verify that his ₹2,300 balance hasn't drifted since last week. A snapshot rate (stored in `fx_rate` column) makes every balance calculation fully reproducible. The rate is shown on the import report so users can see what was used. Default: 1 USD = ₹83.50 (approximate March 2026 mid-market rate).

---

## D06 — Handling the Exact Duplicate (Rows 4 & 5: Marina Bites dinner)

**Decision:** Skip the duplicate row on import; place it in `pending_reviews` for user approval before soft-deletion

**Options considered:**
1. Silently delete the duplicate — fast, but Meera's requirement is to approve deletions
2. Import both rows — double-counts ₹3200, corrupts balances
3. Skip the duplicate + require user approval before soft-delete — respects Meera's requirement

**Chosen:** Option 3

**Rationale:** Meera said "I want to approve anything the app deletes or changes." Silently dropping a row (even a clear duplicate) violates this. The `pending_reviews` table + Reviews UI implements the approval flow directly.

---

## D07 — Handling the Conflicting Duplicate (Rows 23 & 24: Thalassa dinner)

**Decision:** Import both rows; place both in `pending_reviews`

**Options considered:**
1. Pick the higher amount (Rohan's ₹2450) — arbitrary, note says Aisha's might be wrong
2. Pick the lower amount — equally arbitrary
3. Import both, flag both, require user to decide — preserves data, respects Meera

**Chosen:** Option 3

**Rationale:** This is not an exact duplicate (different payers, different amounts). We cannot safely choose. The note "Aisha also logged this I think hers is wrong" is informative but not authoritative — the word "think" makes it a suggestion, not a fact. Human review is required. Balance impact: until one is deleted, both affect totals, which is surfaced clearly in the import report.

---

## D08 — Handling the Settlement Row (Row 13: "Rohan paid Aisha back")

**Decision:** Import as `is_settlement = TRUE`; exclude from expense balances; place in `pending_reviews`

**Options considered:**
1. Skip it — loses the information
2. Import as a normal expense — Rohan gets incorrectly "owed" ₹5000 more
3. Import as a settlement record — correctly reduces Rohan's outstanding balance to Aisha

**Chosen:** Option 3

**Rationale:** The note explicitly says "this is a settlement not an expense??" — the person who entered it knew it was wrong. Settlements must be tracked (they reduce balances) but must not appear in the expense list. The `is_settlement` flag on expenses, plus the `settlements` table for manual settlements, handles both paths.

---

## D09 — Percentage Split Normalisation (Row 14: Pizza Friday, 110%)

**Decision:** Normalise proportionally (divide each percentage by the sum)

**Options considered:**
1. Reject the row — loses a valid expense
2. Ask user to fix percentages — blocks import
3. Normalise proportionally and flag it — import proceeds, user is informed

**Chosen:** Option 3

**Rationale:** The amounts (30/30/30/20 = 110%) look like someone accidentally entered 30% for Priya when they meant 20%. Proportional normalisation is the mathematically sound fix — it preserves the relative intent. The row is placed in `pending_reviews` so the user can see the normalised values and correct them if needed. A crashed import for a 10% overage would be a poor user experience.

---

## D10 — Meera in April Split (Row 35: Groceries 02-04-2026)

**Decision:** Remove Meera from the split; redistribute her share among active members

**Options considered:**
1. Keep Meera in the split — violates Sam's requirement and business logic (she's gone)
2. Remove Meera, split equally among remaining active members — correct
3. Flag for user review — adds friction for a clearly correct action

**Chosen:** Option 2

**Rationale:** Meera's `left_at = 2026-03-31`. The expense date is 2026-04-02. The logic is deterministic: anyone with `left_at < expense_date` is excluded. The note even confirms this was a mistake ("oops Meera still in the group list"). This is an auto-correction, not a judgement call, so it does not require pending review.

---

## D11 — Soft Delete vs Hard Delete

**Decision:** All deletions are soft deletes (`is_deleted = TRUE` on the expense row)

**Options considered:**
1. Hard delete — simpler, but loses audit trail
2. Soft delete with `is_deleted` flag — data is preserved, can be restored

**Chosen:** Option 2 — soft delete

**Rationale:** Meera's requirement to "approve anything the app deletes" implies deletions should be reversible (reject the review → restore the row). An `is_deleted` flag means nothing is ever permanently lost during the import phase. Hard deletes can be run manually by an admin after a retention period.

---

## D12 — Rounding Policy

**Decision:** Round all monetary amounts to 2 decimal places using standard rounding at the split calculation step

**Options considered:**
1. Round each split individually → sum may not equal total (rounding error)
2. Round all except the last person, who gets the remainder — correct by construction
3. Store unrounded and round only on display — accurate storage, messy display

**Chosen:** Option 2 — last-person-gets-remainder

**Rationale:** For an equal split of ₹899.995 among 4 people: per-person = ₹224.999 → rounded to ₹225.00 × 4 = ₹900.00. If we naively round each: 3 × ₹225.00 = ₹675.00, last person = ₹900.00 − ₹675.00 = ₹225.00. Works cleanly here. For cases like ₹100 / 3 = ₹33.33 + ₹33.33 + ₹33.34: first two get ₹33.33, last gets the remainder (₹33.34). This ensures the sum of splits always equals the total.

---

## D13 — Kabir (Guest) Share Absorption

**Decision:** Absorb the guest's (Kabir's) share among the registered members

**Options considered:**
1. Create a temporary "Kabir" user — he can never log in, pollutes the user table
2. Skip the expense — loses ₹150 USD from group history
3. Absorb his share equally among registered split members — simplest, reasonable

**Chosen:** Option 3

**Rationale:** Kabir is a one-time guest. Creating a permanent user record for him is messy. Absorbing his share means Dev (who presumably knew Kabir and brought him along) and the others split the full parasailing cost, which is the practical outcome anyway. The anomaly is logged so it's traceable.

---

## D14 — Zero Amount Row (Row 30: Dinner order Swiggy)

**Decision:** Skip entirely (no DB record created)

**Options considered:**
1. Import with ₹0 — no balance impact, but creates noise in the expense list
2. Skip — cleaner

**Chosen:** Option 2 — skip

**Rationale:** The note says "counted twice earlier - fixing later." A zero-amount row is a placeholder. It has no financial meaning. Importing it would clutter the expense list with a ₹0 entry. Anomaly is logged in `import_log` for the audit trail.

---

## D15 — "Priya S" Name Resolution

**Decision:** Map "Priya S" → "Priya" via the alias table; log as A05

**Options considered:**
1. Treat as unknown person — loses the expense (₹1875)
2. Auto-map to Priya — reasonable assumption, log it
3. Ask user to confirm before import — blocks the import flow

**Chosen:** Option 2 — auto-map with logging

**Rationale:** The alias table is the deliberate mechanism for this. "Priya S" with a last-name initial is a recognisable variant of "Priya" (the only Priya in the group). If there were two Priyas, the alias table would need two entries and we'd flag it. With one Priya, the mapping is safe. The A05 anomaly log entry ensures it's visible to the user.
