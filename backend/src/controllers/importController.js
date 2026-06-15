const multer = require('multer');
const { importCSV } = require('../services/importService');
const db = require('../db');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

async function handleImport(req, res) {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  if (!req.file.originalname.endsWith('.csv'))
    return res.status(400).json({ error: 'Only CSV files accepted' });

  const batchId = `import_${Date.now()}`;
  try {
    const report = await importCSV(req.file.buffer, batchId);
    res.json({ success: true, batchId, report });
  } catch (err) {
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
}

async function getImportReport(req, res) {
  const { batchId } = req.params;
  try {
    const result = await db.query(
      `SELECT il.*, pr.review_type, pr.status as review_status, pr.proposed_action
       FROM import_log il
       LEFT JOIN pending_reviews pr ON pr.import_log_id = il.id
       WHERE il.import_batch = $1
       ORDER BY il.csv_row ASC`,
      [batchId]
    );
    const summary = await db.query(
      `SELECT status, COUNT(*) as count FROM import_log WHERE import_batch = $1 GROUP BY status`,
      [batchId]
    );
    res.json({ rows: result.rows, summary: summary.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getPendingReviews(req, res) {
  try {
    const result = await db.query(
      `SELECT pr.*, il.raw_data, il.csv_row
       FROM pending_reviews pr
       JOIN import_log il ON pr.import_log_id = il.id
       WHERE pr.status = 'pending'
       ORDER BY pr.created_at ASC`
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function resolveReview(req, res) {
  const { id } = req.params;
  const { decision } = req.body; // 'approved' | 'rejected'
  if (!['approved', 'rejected'].includes(decision))
    return res.status(400).json({ error: 'decision must be approved or rejected' });

  try {
    await db.query(
      `UPDATE pending_reviews 
       SET status = $1, reviewed_by = $2, reviewed_at = NOW()
       WHERE id = $3`,
      [decision, req.user.id, id]
    );

    // If approved deletion of a duplicate, soft-delete it
    const review = await db.query('SELECT * FROM pending_reviews WHERE id = $1', [id]);
    const r = review.rows[0];
    if (decision === 'approved' && r.review_type.includes('A01') && r.import_log_id) {
      const logEntry = await db.query('SELECT expense_id FROM import_log WHERE id = $1', [r.import_log_id]);
      if (logEntry.rows[0]?.expense_id) {
        await db.query('UPDATE expenses SET is_deleted = TRUE WHERE id = $1', [logEntry.rows[0].expense_id]);
      }
    }

    res.json({ message: `Review ${decision}` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

module.exports = { upload, handleImport, getImportReport, getPendingReviews, resolveReview };
