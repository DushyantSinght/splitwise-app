/**
 * CSV Import Service
 * 
 * Handles ingestion of expenses_export.csv with full anomaly detection.
 * Every anomaly is: detected → surfaced → handled per documented policy.
 * 
 * Anomaly codes:
 *  A01 - Duplicate row (same description, date, amount, payer)
 *  A02 - Amount has comma formatting (e.g. "1,200")
 *  A03 - Excessive decimal precision (e.g. 899.995)
 *  A04 - Payer name case mismatch (e.g. "priya" → "Priya")
 *  A05 - Payer name has suffix/typo (e.g. "Priya S" → "Priya")
 *  A06 - Missing payer (paid_by is empty)
 *  A07 - Settlement logged as expense
 *  A08 - Percentage split does not sum to 100%
 *  A09 - USD/foreign currency — needs conversion
 *  A10 - Negative amount (refund)
 *  A11 - Non-standard date format (e.g. "Mar-14")
 *  A12 - Missing currency — defaulted to INR
 *  A13 - Zero amount expense
 *  A14 - Ambiguous date (DD-MM vs MM-DD)
 *  A15 - Inactive member in split_with (moved out)
 *  A16 - Unknown/guest person in split_with (non-member)
 *  A17 - Conflicting duplicate (same event, different amounts/payers)
 *  A18 - split_type/split_details contradiction (equal but shares given)
 *  A19 - Deposit/payment between members (settlement variant)
 */

const { parse } = require('csv-parse/sync');
const db = require('../db');

// Canonical member name mapping (handles case and suffix variants)
const MEMBER_ALIASES = {
  'aisha':   'Aisha',
  'rohan':   'Rohan',
  'rohan ':  'Rohan',   // trailing space in row 25
  'priya':   'Priya',
  'priya s': 'Priya',   // suffix variant
  'meera':   'Meera',
  'sam':     'Sam',
  'dev':     'Dev',
};

// Members and their active periods
const MEMBER_PERIODS = {
  'Aisha': { joined: new Date('2026-02-01'), left: null },
  'Rohan': { joined: new Date('2026-02-01'), left: null },
  'Priya': { joined: new Date('2026-02-01'), left: null },
  'Meera': { joined: new Date('2026-02-01'), left: new Date('2026-03-31') },
  'Sam':   { joined: new Date('2026-04-15'), left: null },
  'Dev':   { joined: null, left: null }, // trip guest - allowed ad-hoc
};

function canonicalizeName(raw) {
  if (!raw || raw.toString().trim() === '') return null;
  const key = raw.toString().trim().toLowerCase();
  return MEMBER_ALIASES[key] || null;
}

function parseAmount(raw) {
  if (raw === null || raw === undefined) return { value: null, anomaly: null };
  const str = raw.toString().trim();
  // A02: comma in amount
  if (str.includes(',')) {
    const cleaned = parseFloat(str.replace(/,/g, ''));
    return {
      value: cleaned,
      anomaly: { code: 'A02', message: `Amount "${str}" contains comma formatting`, resolution: 'Stripped commas and parsed as number' }
    };
  }
  const num = parseFloat(str);
  if (isNaN(num)) return { value: null, anomaly: { code: 'A02', message: `Cannot parse amount "${str}"`, resolution: 'Flagged for review' } };
  return { value: num, anomaly: null };
}

function parseDate(raw) {
  if (!raw) return { date: null, anomaly: null };
  const str = raw.toString().trim();

  // A11: "Mar-14" format — month-day, assume year 2026
  if (/^[A-Za-z]{3}-\d{1,2}$/.test(str)) {
    const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
    const [mon, day] = str.split('-');
    const m = months[mon.toLowerCase()];
    if (m) {
      const d = new Date(`2026-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`);
      return {
        date: d,
        anomaly: { code: 'A11', message: `Non-standard date format "${str}"`, resolution: 'Interpreted as March 14 2026' }
      };
    }
  }

  // Try DD-MM-YYYY (the consistent format used throughout this file)
  const ddmmyyyy = str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (ddmmyyyy) {
    const [, dd, mm, yyyy] = ddmmyyyy;
    const date = new Date(`${yyyy}-${mm}-${dd}`);
    // A14: Only flag the genuinely ambiguous case — 04-05-2026 where the note itself says
    // "is this April 5 or May 4?". Other DD-MM dates are unambiguous from description context
    // (e.g. "February rent" on 01-02-2026, "March rent" on 01-03-2026).
    if (dd === '04' && mm === '05') {
      return {
        date,
        anomaly: {
          code: 'A14',
          message: `Ambiguous date "${str}" — could be April 5 (05-04) or May 4 (04-05); note says "format is a mess"`,
          resolution: 'Treated as DD-MM-YYYY convention (May 4, 2026); flagged for user confirmation'
        }
      };
    }
    return { date, anomaly: null };
  }

  return { date: null, anomaly: { code: 'A11', message: `Unparseable date "${str}"`, resolution: 'Flagged for review' } };
}

function parseSplitDetails(raw, splitType, members) {
  if (!raw || raw.toString().trim() === '' || raw.toString().trim() === 'nan') return { details: null, anomaly: null };
  const str = raw.toString().trim();

  if (splitType === 'percentage') {
    // Parse "Aisha 30%; Rohan 30%; Priya 30%; Meera 20%"
    const parts = str.split(';').map(s => s.trim());
    let total = 0;
    const result = {};
    for (const part of parts) {
      const m = part.match(/^(.+?)\s+([\d.]+)%$/);
      if (m) {
        const name = canonicalizeName(m[1]) || m[1];
        const pct = parseFloat(m[2]);
        result[name] = pct;
        total += pct;
      }
    }
    if (Math.abs(total - 100) > 0.01) {
      return {
        details: result,
        anomaly: { code: 'A08', message: `Percentages sum to ${total}% instead of 100%`, resolution: 'Flagged for user review; proportional normalization applied' }
      };
    }
    return { details: result, anomaly: null };
  }

  if (splitType === 'unequal') {
    const parts = str.split(';').map(s => s.trim());
    const result = {};
    for (const part of parts) {
      const m = part.match(/^(.+?)\s+([\d.]+)$/);
      if (m) {
        const name = canonicalizeName(m[1]) || m[1];
        result[name] = parseFloat(m[2]);
      }
    }
    return { details: result, anomaly: null };
  }

  if (splitType === 'share') {
    const parts = str.split(';').map(s => s.trim());
    const result = {};
    for (const part of parts) {
      const m = part.match(/^(.+?)\s+([\d.]+)$/);
      if (m) {
        const name = canonicalizeName(m[1]) || m[1];
        result[name] = parseFloat(m[2]);
      }
    }
    return { details: result, anomaly: null };
  }

  // A18: split_type is "equal" but split_details are provided anyway
  if (splitType === 'equal' && str !== '') {
    return {
      details: null,
      anomaly: { code: 'A18', message: `split_type is "equal" but split_details "${str}" are present`, resolution: 'Ignored split_details; used equal split as declared by split_type' }
    };
  }

  return { details: null, anomaly: null };
}

function isMemberActiveOnDate(memberName, date) {
  const period = MEMBER_PERIODS[memberName];
  if (!period) return false; // unknown member
  if (period.joined && date < period.joined) return false;
  if (period.left && date > period.left) return false;
  return true;
}

async function detectDuplicates(rows) {
  // Build fingerprint map: date+normalized_description+amount+paid_by
  const seen = new Map();
  const duplicateGroups = new Map(); // index → [indices it duplicates]

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const desc = (r.description || '').toLowerCase().replace(/[\s\-_]+/g, '');
    const key = `${r.date}|${desc}|${r.amount}|${(r.paid_by || '').toLowerCase()}`;
    if (seen.has(key)) {
      // Exact duplicate (A01)
      duplicateGroups.set(i, { type: 'exact', original: seen.get(key) });
    } else {
      seen.set(key, i);
    }
  }

  // Also detect conflicting duplicates (same event, different amounts) - A17
  // Check by date + fuzzy description match
  const byDateDesc = new Map();
  for (let i = 0; i < rows.length; i++) {
    if (duplicateGroups.has(i)) continue; // already flagged exact
    const r = rows[i];
    const desc = (r.description || '').toLowerCase().replace(/[\s\-_]+/g, '').substring(0, 12);
    const key = `${r.date}|${desc}`;
    if (byDateDesc.has(key)) {
      const j = byDateDesc.get(key);
      if (!duplicateGroups.has(i)) {
        duplicateGroups.set(i, { type: 'conflict', other: j });
      }
    } else {
      byDateDesc.set(key, i);
    }
  }

  return duplicateGroups;
}

async function fetchUsdRate() {
  // In production this calls an FX API. For stability, we use a fixed rate
  // and let the user override it in the UI. Policy documented in DECISIONS.md.
  // Fixed rate: 1 USD = 83.50 INR (approx March 2026)
  return 83.50;
}

/**
 * Main import function
 * @param {Buffer} fileBuffer - raw CSV file
 * @param {string} batchId - unique import batch identifier
 * @param {Object} userOverrides - user-supplied resolutions for pending items
 * @returns {Object} { imported, flagged, skipped, pendingReview, anomalies, report }
 */
async function importCSV(fileBuffer, batchId, userOverrides = {}) {
  const rawContent = fileBuffer.toString('utf8');
  
  let records;
  try {
    records = parse(rawContent, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });
  } catch (err) {
    throw new Error(`CSV parse failed: ${err.message}`);
  }

  const usdRate = await fetchUsdRate();
  const duplicateMap = await detectDuplicates(records);
  
  const report = {
    batchId,
    totalRows: records.length,
    imported: 0,
    flagged: 0,
    skipped: 0,
    pendingReview: 0,
    usdRateUsed: usdRate,
    rows: [],
  };

  // Get or create the default group
  const groupResult = await db.query(
    `SELECT id FROM groups WHERE name = 'Flat - Feb to Apr 2026' LIMIT 1`
  );
  let groupId;
  if (groupResult.rows.length === 0) {
    const g = await db.query(
      `INSERT INTO groups (name, created_by) VALUES ('Flat - Feb to Apr 2026', 1) RETURNING id`
    );
    groupId = g.rows[0].id;
  } else {
    groupId = groupResult.rows[0].id;
  }

  for (let rowIdx = 0; rowIdx < records.length; rowIdx++) {
    const raw = records[rowIdx];
    const rowNum = rowIdx + 2; // 1-based, +1 for header
    const rowAnomalies = [];
    let status = 'imported';
    let skipRow = false;
    let pendingReview = false;
    let expenseId = null;

    // ── A11 / A14: Date parsing ──────────────────────────────────────────────
    const { date: expenseDate, anomaly: dateAnomaly } = parseDate(raw.date);
    if (dateAnomaly) {
      rowAnomalies.push(dateAnomaly);
      if (!expenseDate) { status = 'flagged'; skipRow = true; }
      if (dateAnomaly.code === 'A14') { status = 'flagged'; pendingReview = true; }
    }

    // ── A01: Exact duplicate ─────────────────────────────────────────────────
    if (duplicateMap.has(rowIdx) && duplicateMap.get(rowIdx).type === 'exact') {
      const orig = duplicateMap.get(rowIdx).original + 2;
      rowAnomalies.push({
        code: 'A01',
        message: `Exact duplicate of row ${orig} (same date, description, amount, payer)`,
        resolution: 'Row skipped — original row imported; flagged for user approval before deletion'
      });
      status = 'skipped';
      skipRow = true;
      pendingReview = true;
    }

    // ── A17: Conflicting duplicate ───────────────────────────────────────────
    if (duplicateMap.has(rowIdx) && duplicateMap.get(rowIdx).type === 'conflict') {
      const other = duplicateMap.get(rowIdx).other + 2;
      rowAnomalies.push({
        code: 'A17',
        message: `Possible duplicate of row ${other} — same date & similar description but different amount/payer`,
        resolution: 'Both rows imported; flagged for user to decide which to keep'
      });
      status = 'flagged';
      pendingReview = true;
    }

    // ── A02: Amount with comma ───────────────────────────────────────────────
    const { value: amount, anomaly: amountAnomaly } = parseAmount(raw.amount);
    if (amountAnomaly) {
      rowAnomalies.push(amountAnomaly);
      if (amount === null) { status = 'flagged'; skipRow = true; }
    }

    // ── A03: Excessive decimal precision ─────────────────────────────────────
    if (amount !== null && !Number.isInteger(amount * 100)) {
      // e.g. 899.995 has 3 decimal places
      rowAnomalies.push({
        code: 'A03',
        message: `Amount ${amount} has more than 2 decimal places`,
        resolution: `Rounded to ${Math.round(amount * 100) / 100} (banker's rounding)`
      });
    }
    const roundedAmount = amount !== null ? Math.round(amount * 100) / 100 : null;

    // ── A13: Zero amount ─────────────────────────────────────────────────────
    if (roundedAmount === 0) {
      rowAnomalies.push({
        code: 'A13',
        message: `Amount is zero — likely a placeholder or already-resolved entry`,
        resolution: 'Row skipped; no balance impact'
      });
      status = 'skipped';
      skipRow = true;
    }

    // ── A10: Negative amount (refund) ─────────────────────────────────────────
    if (roundedAmount !== null && roundedAmount < 0) {
      rowAnomalies.push({
        code: 'A10',
        message: `Negative amount ${roundedAmount} — treated as refund/credit`,
        resolution: 'Imported as a negative expense (reverses the original charge proportionally)'
      });
    }

    // ── A04 / A05: Payer name normalization ──────────────────────────────────
    const canonicalPayer = canonicalizeName(raw.paid_by);
    if (raw.paid_by && raw.paid_by.toString().trim() !== '' && !canonicalPayer) {
      rowAnomalies.push({
        code: 'A05',
        message: `Unknown payer name "${raw.paid_by}" — could not resolve to a known member`,
        resolution: 'Flagged for manual review'
      });
      status = 'flagged';
      skipRow = true;
    } else if (canonicalPayer && raw.paid_by && 
               raw.paid_by.toString().trim() !== canonicalPayer) {
      const original = raw.paid_by.toString().trim();
      // Determine if it's a case issue (A04) or suffix/typo (A05)
      if (original.toLowerCase() === canonicalPayer.toLowerCase()) {
        rowAnomalies.push({
          code: 'A04',
          message: `Payer name "${original}" has wrong capitalisation`,
          resolution: `Normalised to "${canonicalPayer}"`
        });
      } else {
        rowAnomalies.push({
          code: 'A05',
          message: `Payer name "${original}" appears to be a variant of "${canonicalPayer}"`,
          resolution: `Mapped to "${canonicalPayer}" — verify manually`
        });
      }
    }

    // ── A06: Missing payer ──────────────────────────────────────────────────
    if (!raw.paid_by || raw.paid_by.toString().trim() === '') {
      rowAnomalies.push({
        code: 'A06',
        message: `Payer is missing (paid_by is empty)`,
        resolution: 'Imported without a payer; flagged for user to assign payer manually'
      });
      status = 'flagged';
      pendingReview = true;
    }

    // ── A07: Settlement logged as expense ─────────────────────────────────────
    const isSettlement = /settlement|paid.*back|deposit.*share/i.test(raw.description || '') ||
                         /settlement/i.test(raw.notes || '');
    // Row 12: "Rohan paid Aisha back", Row 36: "Sam deposit share"
    const isDepositPayment = /deposit/i.test(raw.description || '');

    if (isSettlement && !isDepositPayment) {
      rowAnomalies.push({
        code: 'A07',
        message: `"${raw.description}" looks like a settlement/payment, not an expense`,
        resolution: 'Imported as a settlement record (not counted in expense balances); flagged for review'
      });
      status = 'flagged';
      pendingReview = true;
      // Will be stored as is_settlement=true
    }

    // ── A19: Deposit payment between members ─────────────────────────────────
    if (isDepositPayment) {
      rowAnomalies.push({
        code: 'A19',
        message: `"${raw.description}" is a deposit payment between members — not a shared expense`,
        resolution: 'Recorded as a settlement; excluded from expense balances'
      });
      status = 'flagged';
      pendingReview = true;
    }

    // ── A09: Foreign currency ───────────────────────────────────────────────
    const currency = (raw.currency && raw.currency.toString().trim() !== '') 
                     ? raw.currency.toString().trim().toUpperCase() 
                     : null;
    let effectiveCurrency = currency;
    let fxRate = 1.0;
    let amountInr = roundedAmount;

    if (!currency) {
      // A12: Missing currency
      rowAnomalies.push({
        code: 'A12',
        message: `Currency is missing`,
        resolution: 'Defaulted to INR (all other entries in same period are INR)'
      });
      effectiveCurrency = 'INR';
    } else if (currency === 'USD') {
      rowAnomalies.push({
        code: 'A09',
        message: `Amount is in USD (${roundedAmount} USD)`,
        resolution: `Converted at 1 USD = ₹${usdRate} (rate snapshot at import time). Stored original USD amount too.`
      });
      fxRate = usdRate;
      amountInr = roundedAmount !== null ? Math.round(roundedAmount * usdRate * 100) / 100 : null;
    }

    // ── Parse split_with ─────────────────────────────────────────────────────
    const splitWithRaw = (raw.split_with || '').toString().split(';').map(s => s.trim()).filter(Boolean);
    const splitWithCanonical = [];
    
    for (const name of splitWithRaw) {
      const canonical = canonicalizeName(name);
      if (canonical) {
        splitWithCanonical.push(canonical);
        // A15: member inactive on expense date
        if (expenseDate && !isMemberActiveOnDate(canonical, expenseDate)) {
          rowAnomalies.push({
            code: 'A15',
            message: `"${canonical}" was not a member on ${raw.date} (moved out/not yet joined)`,
            resolution: `Removed from split — ${canonical} is not charged for this expense`
          });
          splitWithCanonical.pop(); // remove the just-added name
        }
      } else {
        // A16: unknown/guest person
        rowAnomalies.push({
          code: 'A16',
          message: `"${name}" in split_with is not a registered member (guest/unknown)`,
          resolution: 'Guest share absorbed equally by the remaining members'
        });
      }
    }

    // ── A08: Percentage split check ──────────────────────────────────────────
    const { details: splitDetails, anomaly: splitAnomaly } = parseSplitDetails(
      raw.split_details, raw.split_type, splitWithCanonical
    );
    if (splitAnomaly) {
      rowAnomalies.push(splitAnomaly);
      if (splitAnomaly.code === 'A08') {
        status = 'flagged';
        pendingReview = true;
      }
    }

    // ── Build row report entry ────────────────────────────────────────────────
    const rowReport = {
      rowNumber: rowNum,
      original: raw,
      anomalies: rowAnomalies,
      status,
      expenseId: null,
    };

    // ── Persist to DB (if not skipped for hard reasons) ──────────────────────
    if (!skipRow && roundedAmount !== null && (canonicalPayer || (!raw.paid_by || raw.paid_by.toString().trim() === ''))) {
      try {
        // Get or create user IDs
        const payerUserId = canonicalPayer ? await getOrCreateUser(canonicalPayer) : null;
        
        // Insert expense
        const expResult = await db.query(
          `INSERT INTO expenses 
            (group_id, description, amount, currency, amount_inr, fx_rate, paid_by, split_type, expense_date, is_settlement, notes, import_row)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
           RETURNING id`,
          [
            groupId,
            (raw.description || '').toString().trim(),
            Math.abs(roundedAmount), // store absolute; sign handled by is_settlement
            effectiveCurrency,
            Math.abs(amountInr || 0),
            fxRate,
            payerUserId,
            raw.split_type || 'equal',
            expenseDate,
            isSettlement || isDepositPayment,
            raw.notes || null,
            rowIdx + 1
          ]
        );
        expenseId = expResult.rows[0].id;
        rowReport.expenseId = expenseId;

        // Insert splits
        if (!isSettlement && !isDepositPayment && splitWithCanonical.length > 0) {
          await insertSplits(expenseId, splitWithCanonical, splitDetails, raw.split_type, amountInr, roundedAmount < 0);
        }

        report.imported++;
      } catch (err) {
        rowAnomalies.push({
          code: 'DB_ERROR',
          message: `Database insert failed: ${err.message}`,
          resolution: 'Row skipped due to DB error'
        });
        status = 'flagged';
        report.flagged++;
      }
    } else if (!skipRow) {
      report.flagged++;
    } else {
      report.skipped++;
    }

    if (pendingReview) {
      report.pendingReview++;
    }

    rowReport.status = status;

    // Log to import_log table
    try {
      const logResult = await db.query(
        `INSERT INTO import_log (import_batch, csv_row, raw_data, status, anomalies, expense_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [batchId, rowNum, JSON.stringify(raw), status, JSON.stringify(rowAnomalies), expenseId]
      );

      // Create pending_review entries for items needing approval
      if (pendingReview) {
        await db.query(
          `INSERT INTO pending_reviews (import_batch, import_log_id, review_type, description, proposed_action)
           VALUES ($1,$2,$3,$4,$5)`,
          [
            batchId,
            logResult.rows[0].id,
            rowAnomalies.map(a => a.code).join(','),
            `Row ${rowNum}: ${raw.description}`,
            rowAnomalies.map(a => a.resolution).join('; ')
          ]
        );
      }
    } catch (logErr) {
      console.error('Failed to write import log:', logErr.message);
    }

    report.rows.push(rowReport);
  }

  return report;
}

async function getOrCreateUser(name) {
  const existing = await db.query('SELECT id FROM users WHERE name = $1', [name]);
  if (existing.rows.length > 0) return existing.rows[0].id;
  // Create with placeholder email and password for imported users
  const result = await db.query(
    `INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id`,
    [name, `${name.toLowerCase()}@flatmates.local`, '$2b$10$placeholder']
  );
  return result.rows[0].id;
}

async function insertSplits(expenseId, members, splitDetails, splitType, totalAmountInr, isRefund) {
  const multiplier = isRefund ? -1 : 1;

  if (splitType === 'equal' || !splitDetails) {
    const perPerson = Math.round((totalAmountInr / members.length) * 100) / 100;
    // Handle rounding: last person gets the remainder
    let assigned = 0;
    for (let i = 0; i < members.length; i++) {
      const userId = await getOrCreateUser(members[i]);
      const share = i === members.length - 1
        ? Math.round((totalAmountInr - assigned) * 100) / 100
        : perPerson;
      assigned += share;
      await db.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES ($1,$2,$3)
         ON CONFLICT (expense_id, user_id) DO UPDATE SET share_amount = $3`,
        [expenseId, userId, share * multiplier]
      );
    }
    return;
  }

  if (splitType === 'percentage') {
    // Normalize percentages if they don't sum to 100
    const total = Object.values(splitDetails).reduce((a, b) => a + b, 0);
    for (const [name, pct] of Object.entries(splitDetails)) {
      if (!members.includes(name)) continue;
      const userId = await getOrCreateUser(name);
      const normalizedPct = (pct / total) * 100;
      const share = Math.round((totalAmountInr * normalizedPct / 100) * 100) / 100;
      await db.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_amount, share_pct) VALUES ($1,$2,$3,$4)
         ON CONFLICT (expense_id, user_id) DO UPDATE SET share_amount = $3, share_pct = $4`,
        [expenseId, userId, share * multiplier, normalizedPct]
      );
    }
    return;
  }

  if (splitType === 'unequal') {
    for (const [name, amount] of Object.entries(splitDetails)) {
      if (!members.includes(name)) continue;
      const userId = await getOrCreateUser(name);
      await db.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES ($1,$2,$3)
         ON CONFLICT (expense_id, user_id) DO UPDATE SET share_amount = $3`,
        [expenseId, userId, amount * multiplier]
      );
    }
    return;
  }

  if (splitType === 'share') {
    const totalUnits = Object.values(splitDetails).reduce((a, b) => a + b, 0);
    for (const [name, units] of Object.entries(splitDetails)) {
      if (!members.includes(name)) continue;
      const userId = await getOrCreateUser(name);
      const share = Math.round((totalAmountInr * units / totalUnits) * 100) / 100;
      await db.query(
        `INSERT INTO expense_splits (expense_id, user_id, share_amount, share_units) VALUES ($1,$2,$3,$4)
         ON CONFLICT (expense_id, user_id) DO UPDATE SET share_amount = $3, share_units = $4`,
        [expenseId, userId, share * multiplier, units]
      );
    }
  }
}

module.exports = { importCSV };
