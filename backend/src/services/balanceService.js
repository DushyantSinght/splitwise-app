/**
 * Balance Service
 * 
 * Computes who owes whom using the "minimize transactions" algorithm.
 * All amounts are in INR (already converted at import time).
 */

const db = require('../db');

/**
 * Get net balance for each member in a group.
 * Returns: { memberName: netBalance } 
 * Positive = is owed money, Negative = owes money
 */
async function getGroupBalances(groupId) {
  // Sum what each person paid
  const paidResult = await db.query(
    `SELECT u.name, COALESCE(SUM(e.amount_inr), 0) as total_paid
     FROM expenses e
     JOIN users u ON e.paid_by = u.id
     WHERE e.group_id = $1 
       AND e.is_deleted = FALSE
       AND e.is_settlement = FALSE
     GROUP BY u.name`,
    [groupId]
  );

  // Sum what each person owes (their splits)
  const owesResult = await db.query(
    `SELECT u.name, COALESCE(SUM(es.share_amount), 0) as total_owes
     FROM expense_splits es
     JOIN expenses e ON es.expense_id = e.id
     JOIN users u ON es.user_id = u.id
     WHERE e.group_id = $1
       AND e.is_deleted = FALSE
       AND e.is_settlement = FALSE
     GROUP BY u.name`,
    [groupId]
  );

  // Sum settlements already made
  const settledResult = await db.query(
    `SELECT 
       u_from.name as paid_by,
       u_to.name as paid_to,
       SUM(s.amount) as amount
     FROM settlements s
     JOIN users u_from ON s.paid_by = u_from.id
     JOIN users u_to ON s.paid_to = u_to.id
     WHERE s.group_id = $1
     GROUP BY u_from.name, u_to.name`,
    [groupId]
  );

  // Build balance map
  const balances = {};
  for (const row of paidResult.rows) {
    balances[row.name] = (balances[row.name] || 0) + parseFloat(row.total_paid);
  }
  for (const row of owesResult.rows) {
    balances[row.name] = (balances[row.name] || 0) - parseFloat(row.total_owes);
  }
  // Apply settlements
  for (const row of settledResult.rows) {
    balances[row.paid_by] = (balances[row.paid_by] || 0) - parseFloat(row.amount);
    balances[row.paid_to] = (balances[row.paid_to] || 0) + parseFloat(row.amount);
  }

  return balances;
}

/**
 * Minimize transactions algorithm.
 * Given net balances, returns the minimum set of payments to settle all debts.
 * e.g. [{ from: 'Rohan', to: 'Aisha', amount: 2300 }]
 */
function minimizeTransactions(balances) {
  const creditors = []; // owed money (positive balance)
  const debtors = [];   // owe money (negative balance)

  for (const [name, bal] of Object.entries(balances)) {
    const rounded = Math.round(bal * 100) / 100;
    if (rounded > 0.01) creditors.push({ name, amount: rounded });
    else if (rounded < -0.01) debtors.push({ name, amount: -rounded });
  }

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;

  while (i < creditors.length && j < debtors.length) {
    const credit = creditors[i];
    const debt = debtors[j];
    const amount = Math.min(credit.amount, debt.amount);

    transactions.push({
      from: debt.name,
      to: credit.name,
      amount: Math.round(amount * 100) / 100,
    });

    credit.amount -= amount;
    debt.amount -= amount;

    if (credit.amount < 0.01) i++;
    if (debt.amount < 0.01) j++;
  }

  return transactions;
}

/**
 * Get expense breakdown for a specific member — answers Rohan's requirement:
 * "I want to see exactly which expenses make up my balance"
 */
async function getMemberBreakdown(groupId, userId) {
  const result = await db.query(
    `SELECT 
       e.id,
       e.description,
       e.expense_date,
       e.amount_inr as total_amount,
       e.currency,
       e.amount as original_amount,
       e.fx_rate,
       u_payer.name as paid_by_name,
       es.share_amount,
       e.split_type,
       e.notes
     FROM expense_splits es
     JOIN expenses e ON es.expense_id = e.id
     JOIN users u_payer ON e.paid_by = u_payer.id
     WHERE e.group_id = $1
       AND es.user_id = $2
       AND e.is_deleted = FALSE
       AND e.is_settlement = FALSE
     ORDER BY e.expense_date ASC`,
    [groupId, userId]
  );

  const paid = await db.query(
    `SELECT 
       e.id,
       e.description,
       e.expense_date,
       e.amount_inr,
       e.split_type
     FROM expenses e
     WHERE e.group_id = $1
       AND e.paid_by = $2
       AND e.is_deleted = FALSE
       AND e.is_settlement = FALSE
     ORDER BY e.expense_date ASC`,
    [groupId, userId]
  );

  return {
    owes: result.rows,
    paid: paid.rows,
  };
}

module.exports = { getGroupBalances, minimizeTransactions, getMemberBreakdown };
