const db = require('../db');

async function createGroup(req, res) {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  try {
    const result = await db.query(
      'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING *',
      [name, req.user.id]
    );
    // Auto-add creator as member
    await db.query(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1, $2, CURRENT_DATE)',
      [result.rows[0].id, req.user.id]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function listGroups(req, res) {
  try {
    const result = await db.query(
      `SELECT g.*, u.name as created_by_name,
              COUNT(DISTINCT gm.user_id) FILTER (WHERE gm.left_at IS NULL) as active_member_count
       FROM groups g
       JOIN users u ON g.created_by = u.id
       LEFT JOIN group_members gm ON gm.group_id = g.id
       WHERE g.created_by = $1 OR EXISTS (
         SELECT 1 FROM group_members gm2 WHERE gm2.group_id = g.id AND gm2.user_id = $1
       )
       GROUP BY g.id, u.name
       ORDER BY g.created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getGroup(req, res) {
  const { id } = req.params;
  try {
    const group = await db.query('SELECT * FROM groups WHERE id = $1', [id]);
    if (group.rows.length === 0) return res.status(404).json({ error: 'Group not found' });

    const members = await db.query(
      `SELECT u.id, u.name, u.email, gm.joined_at, gm.left_at
       FROM group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = $1
       ORDER BY gm.joined_at ASC`,
      [id]
    );

    res.json({ ...group.rows[0], members: members.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function addMember(req, res) {
  const { id } = req.params;
  const { user_id, joined_at } = req.body;
  if (!user_id || !joined_at) return res.status(400).json({ error: 'user_id and joined_at required' });
  try {
    await db.query(
      'INSERT INTO group_members (group_id, user_id, joined_at) VALUES ($1, $2, $3)',
      [id, user_id, joined_at]
    );
    res.status(201).json({ message: 'Member added' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function removeMember(req, res) {
  const { id, userId } = req.params;
  const { left_at } = req.body;
  if (!left_at) return res.status(400).json({ error: 'left_at date required' });
  try {
    await db.query(
      'UPDATE group_members SET left_at = $1 WHERE group_id = $2 AND user_id = $3 AND left_at IS NULL',
      [left_at, id, userId]
    );
    res.json({ message: 'Member marked as left' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getBalances(req, res) {
  const { id } = req.params;
  try {
    const { getGroupBalances, minimizeTransactions } = require('../services/balanceService');
    const balances = await getGroupBalances(parseInt(id));
    const settlements = minimizeTransactions(balances);
    res.json({ balances, settlements });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { createGroup, listGroups, getGroup, addMember, removeMember, getBalances };
