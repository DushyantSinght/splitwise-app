# SCOPE.md — Anomaly Log & Database Schema

## Database Schema

### Tables

**users** — registered app users / flat members
```
id | name | email | password | created_at
```

**groups** — a flat or trip; one group was created for the import
```
id | name | created_by (→ users) | created_at
```

**group_members** — temporal membership with join/leave dates
```
id | group_id | user_id | joined_at | left_at (NULL = still active)
```
Key design: `left_at = NULL` means currently active. Queries filter by date to determine membership at the time of an expense.

**expenses** — individual expense records
```
id | group_id | description | amount (original) | currency | amount_inr (converted)
   | fx_rate | paid_by (→ users) | split_type | expense_date
   | is_settlement | is_deleted (soft delete) | notes | import_row
```
`amount_inr` is always the canonical value used for balance calculations. `amount` stores the original for transparency (e.g. $540 USD).

**expense_splits** — per-person share for each expense
```
id | expense_id | user_id | share_amount (INR) | share_pct | share_units
```
`share_pct` is set for percentage splits, `share_units` for share/ratio splits.

**settlements** — recorded payments between members
```
id | group_id | paid_by | paid_to | amount | currency | settled_at | notes
```
Settlements reduce outstanding balances without affecting expense history.

**import_log** — full audit trail of every CSV row
```
id | import_batch | csv_row | raw_data (JSONB) | status | anomalies (JSONB) | expense_id
```

**pending_reviews** — items requiring human approval (Meera's requirement)
```
id | import_batch | import_log_id | review_type | description | proposed_action
   | status (pending/approved/rejected) | reviewed_by | reviewed_at
```

---

## Anomaly Log

All 42 CSV rows were analysed. 15 distinct anomaly types were found across **18 rows**.

---

### A01 — Exact Duplicate
**Row:** 5 (duplicate of row 4)  
**Description:** `dinner - marina bites` and `Dinner at Marina Bites` — same date (08-02-2026), same amount (₹3200), same payer (Dev)  
**Detection:** Fingerprint built from `normalize(date) + normalize(description) + amount + normalize(paid_by)`. Normalisation strips spaces, hyphens, capitalisation.  
**Policy:** Row 5 is **skipped** on import. The item is placed in `pending_reviews` so a user (Meera) can approve the deletion before it is permanently soft-deleted.  
**Rationale:** Silent deletion violates Meera's requirement. The original (row 4) is kept active.

---

### A02 — Comma in Amount
**Row:** 6  
**Description:** `Electricity Feb` — amount field is `"1,200"` (string with comma separator)  
**Detection:** `parseAmount()` checks if the string contains a comma before calling `parseFloat`.  
**Policy:** Commas stripped, value parsed as `1200`. Anomaly logged. No user action required.

---

### A03 — Excessive Decimal Precision
**Row:** 9  
**Description:** `Cylinder refill` — amount is `899.995`  
**Detection:** Check if `amount * 100` is not an integer (i.e., more than 2 decimal places).  
**Policy:** Rounded to 2 decimal places using banker's rounding: `Math.round(899.995 * 100) / 100 = 900.00`. Anomaly logged.

---

### A04 — Name Capitalisation Mismatch
**Rows:** 8 (paid_by `priya`), 26 (paid_by `rohan ` with trailing space)  
**Detection:** Canonical name lookup fails exact match but succeeds after `.toLowerCase().trim()`.  
**Policy:** Name normalised to canonical form (`Priya`, `Rohan`). Auto-corrected silently; anomaly logged for traceability.

---

### A05 — Name Variant / Suffix
**Row:** 10  
**Description:** `Groceries DMart` — paid_by is `Priya S`  
**Detection:** Canonical lookup table includes `"priya s" → "Priya"`.  
**Policy:** Mapped to `Priya`. Anomaly logged as `A05` with a note to verify manually.  
**Rationale:** "Priya S" is plausibly Priya's full name vs another Priya. The note flags this; import proceeds.

---

### A06 — Missing Payer
**Row:** 12  
**Description:** `House cleaning supplies` — `paid_by` is empty, note says "can't remember who paid"  
**Detection:** `paid_by` field is null/empty after trimming.  
**Policy:** Row is **flagged**. Expense is imported with no `paid_by`, and placed in `pending_reviews` for a user to assign the payer. The expense does not affect balances until a payer is assigned.  
**Rationale:** Skipping it silently loses ₹780 from the group's history.

---

### A07 — Settlement Logged as Expense
**Row:** 13  
**Description:** `Rohan paid Aisha back` — note says "this is a settlement not an expense??"  
**Detection:** Description matches regex `/paid.*back|settlement/i`, confirmed by note text.  
**Policy:** Row is imported as `is_settlement = TRUE`. It is stored in the `settlements` table equivalent (flagged in expenses with is_settlement), not counted in expense balances. Placed in `pending_reviews`.  
**Rationale:** If treated as an expense, Rohan would be "owed" ₹5000 from Aisha again, double-counting the settlement.

---

### A08 — Percentage Split Does Not Sum to 100%
**Row:** 14  
**Description:** `Pizza Friday` — split is `Aisha 30%; Rohan 30%; Priya 30%; Meera 20%` = **110%**  
**Note:** "percentages might be off"  
**Detection:** Sum all percentage values; compare to 100 within tolerance of 0.01%.  
**Policy:** Percentages are **proportionally normalised**: each is divided by the total (110) and multiplied by 100. Actual split becomes Aisha 27.27%, Rohan 27.27%, Priya 27.27%, Meera 18.18%. Item placed in `pending_reviews` so user can confirm.

---

### A09 — Foreign Currency (USD)
**Rows:** 19, 20, 22, 25  
**Description:** Goa villa (USD 540), Beach shack lunch (USD 84), Parasailing (USD 150), Parasailing refund (USD -30)  
**Detection:** `currency` field equals `"USD"`.  
**Policy:** Amount converted to INR at import time using a **snapshot rate** of 1 USD = ₹83.50 (approximate March 2026 rate). Original USD amount and FX rate are stored alongside. Rate is displayed on the import report and can be overridden in UI settings.  
**Rationale:** Storing a snapshot rate means balances are stable and auditable. Priya's complaint ("the sheet pretends a dollar is a rupee") is directly resolved.

---

### A10 — Negative Amount (Refund)
**Row:** 25  
**Description:** `Parasailing refund` — amount is `-30 USD`  
**Detection:** `amount < 0` after parsing.  
**Policy:** Treated as a **refund** — imported with a negative `amount_inr`. This reverses the original parasailing charge proportionally for all split members. The note "one slot got cancelled" confirms this is intentional.  
**Rationale:** A refund is a legitimate financial event, not a data error.

---

### A11 — Non-Standard Date Format
**Row:** 26  
**Description:** `Airport cab` — date is `Mar-14`  
**Detection:** Regex `/^[A-Za-z]{3}-\d{1,2}$/` matches month-abbreviation-day format.  
**Policy:** Interpreted as March 14, 2026 (year inferred from surrounding data). Anomaly logged. No user action needed.

---

### A12 — Missing Currency
**Row:** 27  
**Description:** `Groceries DMart` — currency field is empty, note says "forgot to set currency"  
**Detection:** `currency` is null/empty after trimming.  
**Policy:** **Defaulted to INR**. All other entries in the same period are INR, and the amount (2105) is consistent with Indian grocery spending. Anomaly logged.

---

### A13 — Zero Amount
**Row:** 30  
**Description:** `Dinner order Swiggy` — amount is `0`, note says "counted twice earlier - fixing later"  
**Detection:** `amount === 0` after parsing.  
**Policy:** Row **skipped** entirely. Zero amounts have no balance impact and this note confirms it is a placeholder. Anomaly logged.

---

### A14 — Ambiguous Date
**Row:** 33  
**Description:** `Deep cleaning service` — date is `04-05-2026`, note says "is this April 5 or May 4?"  
**Detection:** Both DD and MM are ≤ 12, making DD-MM and MM-DD both valid.  
**Policy:** Treated as **DD-MM-YYYY = May 4** (consistent with date format used elsewhere in the file). Placed in `pending_reviews` for user to confirm.

---

### A15 — Inactive Member in Split
**Row:** 35  
**Description:** `Groceries BigBasket` (02-04-2026) — `split_with` includes `Meera`, who moved out on 31-03-2026  
**Note:** "oops Meera still in the group list"  
**Detection:** For each name in `split_with`, check `group_members.left_at` against the expense date.  
**Policy:** **Meera is removed from the split**. The expense is split equally among Aisha, Rohan, and Priya only. Anomaly logged.  
**Rationale:** Sam's explicit requirement — members should not be charged for expenses outside their membership period.

---

### A16 — Unknown / Guest in Split
**Row:** 22  
**Description:** `Parasailing` — `split_with` includes `Dev's friend Kabir`  
**Detection:** Name cannot be resolved in the canonical member map.  
**Policy:** Kabir is not a registered member. His share is **absorbed equally by the remaining members** (Aisha, Rohan, Priya, Dev). Anomaly logged.  
**Rationale:** We can't create a balance for a non-member. Absorbing the share is the fairest default.

---

### A17 — Conflicting Duplicate
**Rows:** 23 & 24  
**Description:** `Dinner at Thalassa` (Aisha, ₹2400) and `Thalassa dinner` (Rohan, ₹2450) — same date, similar description, different amounts and payers  
**Note on row 24:** "Aisha also logged this I think hers is wrong"  
**Detection:** Fuzzy fingerprint on date + first 12 normalised description chars; different amount/paid_by = conflict.  
**Policy:** **Both rows are imported** (neither is silently dropped). Both are placed in `pending_reviews`. The user (Meera) must decide which to keep and soft-delete the other.  
**Rationale:** We cannot safely guess which version is correct. The note suggests Rohan's (₹2450) is right, but that is a human decision.

---

### A18 — Split Type Contradiction
**Row:** 41  
**Description:** `Furniture for common room` — `split_type = equal` but `split_details = "Aisha 1; Rohan 1; Priya 1; Sam 1"`  
**Note:** "split_type says equal but someone added shares anyway"  
**Detection:** `split_type === 'equal'` but `split_details` is non-empty.  
**Policy:** `split_type` takes precedence. `split_details` is **ignored** and an equal split is applied. Anomaly logged.  
**Rationale:** The declared split_type is the authoritative field. The details happen to imply equal shares (1:1:1:1), so the result is the same anyway.

---

### A19 — Deposit Payment (Settlement Variant)
**Row:** 37  
**Description:** `Sam deposit share` — Sam pays ₹15000 to Aisha as deposit  
**Detection:** Description matches `/deposit/i`.  
**Policy:** Recorded as a **settlement** (not a shared expense). It reduces Sam's balance against Aisha. Placed in `pending_reviews` to confirm this interpretation.  
**Rationale:** A deposit is a direct payment, not a group expense to be split.

---

## Summary Table

| Code | Description | Rows | Policy |
|------|-------------|------|--------|
| A01 | Exact duplicate | 5 | Skip + pending review |
| A02 | Comma in amount | 6 | Auto-fix (strip comma) |
| A03 | Excess precision | 9 | Round to 2dp |
| A04 | Name capitalisation | 8, 26 | Auto-normalise |
| A05 | Name suffix/variant | 10 | Auto-map, log |
| A06 | Missing payer | 12 | Import flagged, pending review |
| A07 | Settlement as expense | 13 | Reclassify as settlement |
| A08 | Percentages ≠ 100% | 14 | Normalise proportionally |
| A09 | USD currency | 19,20,22,25 | Convert at ₹83.50/USD |
| A10 | Negative (refund) | 25 | Import as negative expense |
| A11 | Non-standard date | 26 | Parse + log |
| A12 | Missing currency | 27 | Default to INR |
| A13 | Zero amount | 30 | Skip |
| A14 | Ambiguous date | 33 | Default DD-MM, pending review |
| A15 | Inactive member in split | 35 | Remove from split |
| A16 | Unknown guest in split | 22 | Absorb share among members |
| A17 | Conflicting duplicate | 23,24 | Import both, pending review |
| A18 | Split type contradiction | 41 | Honour split_type, ignore details |
| A19 | Deposit payment | 37 | Record as settlement |
