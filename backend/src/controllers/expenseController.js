const db = require('../db');
const { getMemberBreakdown } = require('../services/balanceService');

async function listExpenses(req, res) {
  const { groupId } = req.params;
  const { member, from, to } = req.query;
  try {
    let query = `
      SELECT e.*, u.name as paid_by_name,
             json_agg(json_build_object(
               'user_id', es.user_id,
               'name', u2.name,
               'share_amount', es.share_amount,
               'share_pct', es.share_pct,
               'share_units', es.share_units
             )) as splits
      FROM expenses e
      JOIN users u ON e.paid_by = u.id
      LEFT JOIN expense_splits es ON es.expense_id = e.id
      LEFT JOIN users u2 ON es.user_id = u2.id
      WHERE e.group_id = $1 AND e.is_deleted = FALSE`;
    const params = [groupId];
    let p = 2;

    if (member) {
      query += ` AND EXISTS (
        SELECT 1 FROM expense_splits es2 
        JOIN users u3 ON es2.user_id = u3.id
        WHERE es2.expense_id = e.id AND u3.name = $${p}
      )`;
      params.push(member); p++;
    }
    if (from) { query += ` AND e.expense_date >= $${p}`; params.push(from); p++; }
    if (to)   { query += ` AND e.expense_date <= $${p}`; params.push(to);   p++; }

    query += ' GROUP BY e.id, u.name ORDER BY e.expense_date DESC';

    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function createExpense(req, res) {
  const { groupId } = req.params;
  const { description, amount, currency, paid_by, split_type, expense_date, notes, splits } = req.body;
  if (!description || !amount || !paid_by || !split_type || !expense_date)
    return res.status(400).json({ error: 'Missing required fields' });

  const client = await require('../db').pool.connect();
  try {
    await client.query('BEGIN');
    const fxRate = currency === 'USD' ? parseFloat(process.env.USD_RATE || 83.50) : 1.0;
    const amountInr = Math.round(amount * fxRate * 100) / 100;

    const expResult = await client.query(
      `INSERT INTO expenses (group_id, description, amount, currency, amount_inr, fx_rate, paid_by, split_type, expense_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [groupId, description, amount, currency || 'INR', amountInr, fxRate, paid_by, split_type, expense_date, notes || null]
    );
    const expense = expResult.rows[0];

    if (splits && splits.length > 0) {
      for (const split of splits) {
        await client.query(
          `INSERT INTO expense_splits (expense_id, user_id, share_amount, share_pct, share_units)
           VALUES ($1,$2,$3,$4,$5)`,
          [expense.id, split.user_id, split.share_amount, split.share_pct || null, split.share_units || null]
        );
      }
    }

    await client.query('COMMIT');
    res.status(201).json(expense);
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
}

async function updateExpense(req, res) {
  const { id } = req.params;
  const { description, amount, currency, paid_by, split_type, expense_date, notes } = req.body;
  try {
    const result = await db.query(
      `UPDATE expenses SET description=$1, amount=$2, currency=$3, paid_by=$4,
       split_type=$5, expense_date=$6, notes=$7 WHERE id=$8 RETURNING *`,
      [description, amount, currency, paid_by, split_type, expense_date, notes, id]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteExpense(req, res) {
  const { id } = req.params;
  try {
    await db.query('UPDATE expenses SET is_deleted = TRUE WHERE id = $1', [id]);
    res.json({ message: 'Expense soft-deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getMemberExpenses(req, res) {
  const { groupId, userId } = req.params;
  try {
    const breakdown = await getMemberBreakdown(parseInt(groupId), parseInt(userId));
    res.json(breakdown);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function recordSettlement(req, res) {
  const { groupId } = req.params;
  const { paid_by, paid_to, amount, currency, settled_at, notes } = req.body;
  if (!paid_by || !paid_to || !amount || !settled_at)
    return res.status(400).json({ error: 'paid_by, paid_to, amount, settled_at required' });
  try {
    const result = await db.query(
      `INSERT INTO settlements (group_id, paid_by, paid_to, amount, currency, settled_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [groupId, paid_by, paid_to, amount, currency || 'INR', settled_at, notes || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { listExpenses, createExpense, updateExpense, deleteExpense, getMemberExpenses, recordSettlement };
