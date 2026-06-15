# AI_USAGE.md — AI Tool Usage Log

## Tools Used

- **Claude (Anthropic) — claude-sonnet-4-6** — Primary development collaborator
  - Used for: architecture design, code generation, anomaly analysis, documentation drafting
  - All code was reviewed, understood, and where necessary corrected before inclusion

---

## Key Prompts Used

### 1. Initial CSV Analysis
> "Here is expenses_export.csv. Read all 42 rows and give me a complete list of every data anomaly you can find — data quality issues, inconsistencies, formatting problems, and business logic problems. For each one, tell me the row number, what the problem is, and what question it forces me to answer."

This produced the complete anomaly catalogue that became SCOPE.md.

### 2. Architecture Design
> "I need to build a shared expenses app with a relational PostgreSQL schema. The group has members who join and leave at specific dates. Expenses have four split types: equal, unequal, percentage, and share-ratio. I need to track who owes whom and settle debts. Design the schema."

Claude produced the initial schema. I reviewed and added `import_row` column, `pending_reviews` table, and the `fx_rate` / `amount_inr` dual-column design for currency.

### 3. Import Service Core Logic
> "Write a Node.js CSV import service that reads expenses_export.csv and for each row: detects anomalies using the codes A01-A19, applies the policies from my SCOPE.md, and returns a structured report. The function must handle: comma amounts, missing payers, name normalisation, USD conversion, settlement detection, inactive member removal, and duplicate detection."

### 4. Balance Calculation
> "Write a PostgreSQL-backed balance calculation function. It should compute net balance per member (paid minus owed, minus settlements already recorded), then apply a minimize-transactions algorithm to produce the minimum set of payments needed. Explain each step."

### 5. Frontend Component Planning
> "For the group page, I need to satisfy these five requirements: Aisha wants one number per person; Rohan wants to see exactly which expenses make his total; Priya's USD expenses need to show the original amount and conversion; Sam's expenses should only include his membership period; Meera needs to approve deletions. Design the React component structure."

---

## Cases Where the AI Produced Something Wrong

### Case 1: Balance Calculation Double-Counting Settlements

**What the AI generated:**

```javascript
// Original AI-generated code
async function getGroupBalances(groupId) {
  const paidResult = await db.query(
    `SELECT u.name, SUM(e.amount_inr) as total_paid
     FROM expenses e JOIN users u ON e.paid_by = u.id
     WHERE e.group_id = $1 GROUP BY u.name`, [groupId]
  );
  // ... (no settlement deduction)
  return balances;
}
```

**The problem:** The AI omitted the settlement deduction step entirely. If Rohan had already paid Aisha ₹5000, the balance would still show him owing her — settlements had no effect.

**How I caught it:** I manually traced the balance for a scenario: Rohan pays ₹1000 for groceries, Aisha owes ₹500. Rohan records a ₹500 settlement. The function still returned Aisha owing Rohan ₹500 after the settlement. The number should have been 0.

**What I changed:** Added the `settledResult` query and applied it to subtract from the balance map:

```javascript
for (const row of settledResult.rows) {
  balances[row.paid_by] = (balances[row.paid_by] || 0) - parseFloat(row.amount);
  balances[row.paid_to] = (balances[row.paid_to] || 0) + parseFloat(row.amount);
}
```

---

### Case 2: Percentage Normalisation Applied Wrong Direction

**What the AI generated:**

```javascript
// AI wrote this normalisation (incorrect)
const normalizedPct = (pct / 100) * total;  // WRONG
```

**The problem:** The intent was to scale each percentage so they sum to 100. The AI inverted the formula. If total = 110 and pct = 30, the AI's formula gives `(30/100) * 110 = 33`, which is the wrong direction — it inflates rather than reduces.

**Correct formula:**
```javascript
const normalizedPct = (pct / total) * 100;  // e.g. (30/110)*100 = 27.27%
```

**How I caught it:** I tested the Pizza Friday row (30+30+30+20 = 110%) manually. Expected: each percentage should be smaller than the original. AI's output made Aisha's share 33% instead of 27.27%. Clearly wrong direction.

**What I changed:** Flipped the formula to `(pct / total) * 100` and added a test comment explaining the direction.

---

### Case 3: Duplicate Detection Missed the Thalassa Conflict

**What the AI generated initially:**

```javascript
// AI used exact match only
const key = `${r.date}|${r.description.toLowerCase()}|${r.amount}|${r.paid_by.toLowerCase()}`;
if (seen.has(key)) { duplicateGroups.set(i, 'exact'); }
```

**The problem:** This only caught exact duplicates (same description + amount + payer). It missed the Thalassa conflict (rows 23 & 24) where the description is different ("Dinner at Thalassa" vs "Thalassa dinner"), the amount differs (₹2400 vs ₹2450), and the payer differs (Aisha vs Rohan). These are the hardest and most important conflict to catch.

**How I caught it:** I read the CSV myself and noticed rows 23 & 24. Then I tested the AI's duplicate detection against those rows — neither was flagged. The exact-match key produced different fingerprints for both.

**What I changed:** Added a second pass using a **fuzzy fingerprint** — `date + first 12 chars of normalised description` — to catch near-matches with different amounts or payers. This correctly flags rows 23 & 24 as `A17: Conflicting Duplicate` while still distinguishing them from exact duplicates.

```javascript
// Added second pass for conflict detection
const byDateDesc = new Map();
for (let i = 0; i < rows.length; i++) {
  const desc = (rows[i].description || '').toLowerCase()
    .replace(/[\s\-_]+/g, '').substring(0, 12);  // fuzzy prefix
  const key = `${rows[i].date}|${desc}`;
  if (byDateDesc.has(key)) {
    duplicateGroups.set(i, { type: 'conflict', other: byDateDesc.get(key) });
  } else {
    byDateDesc.set(key, i);
  }
}
```

---

## Observations on AI-Assisted Development

1. **The AI is good at structure, weak at cross-row logic.** It wrote correct per-row anomaly detection for most cases, but missed multi-row patterns (conflicting duplicates) that require looking across the whole dataset simultaneously.

2. **Math direction errors are subtle.** The percentage normalisation bug was logically reasonable-looking code that produced wrong results. Unit-testing with known values caught it; a code review alone might not have.

3. **The AI does not know your business rules.** For settlement detection, the AI wrote a generic check but didn't know that "Rohan paid Aisha back" was semantically a settlement. I added the regex patterns based on my reading of the CSV.

4. **Documentation quality is high.** The AI produced well-structured SCOPE.md and DECISIONS.md drafts that I refined with my own reasoning for the trickier decisions (D07 Thalassa conflict, D09 percentage normalisation).

5. **I remained the engineer of record.** Every line in the codebase was read, understood, and where necessary corrected by me. The AI is a fast junior developer; the architectural decisions and anomaly policies are mine.
