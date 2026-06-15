const express = require('express');
const auth = require('../middleware/auth');
const authCtrl = require('../controllers/authController');
const groupCtrl = require('../controllers/groupController');
const expCtrl = require('../controllers/expenseController');
const { upload, handleImport, getImportReport, getPendingReviews, resolveReview } = require('../controllers/importController');

const router = express.Router();

// ── Auth ──────────────────────────────────────────────────────────────────────
router.post('/auth/register', authCtrl.register);
router.post('/auth/login',    authCtrl.login);
router.get('/auth/me',        auth, authCtrl.me);

// ── Groups ────────────────────────────────────────────────────────────────────
router.post('/groups',                           auth, groupCtrl.createGroup);
router.get('/groups',                            auth, groupCtrl.listGroups);
router.get('/groups/:id',                        auth, groupCtrl.getGroup);
router.post('/groups/:id/members',               auth, groupCtrl.addMember);
router.delete('/groups/:id/members/:userId',     auth, groupCtrl.removeMember);
router.get('/groups/:id/balances',               auth, groupCtrl.getBalances);

// ── Expenses ──────────────────────────────────────────────────────────────────
router.get('/groups/:groupId/expenses',                   auth, expCtrl.listExpenses);
router.post('/groups/:groupId/expenses',                  auth, expCtrl.createExpense);
router.put('/expenses/:id',                               auth, expCtrl.updateExpense);
router.delete('/expenses/:id',                            auth, expCtrl.deleteExpense);
router.get('/groups/:groupId/members/:userId/expenses',   auth, expCtrl.getMemberExpenses);
router.post('/groups/:groupId/settlements',               auth, expCtrl.recordSettlement);

// ── Import ────────────────────────────────────────────────────────────────────
router.post('/import',                    auth, upload.single('file'), handleImport);
router.get('/import/:batchId/report',     auth, getImportReport);
router.get('/import/reviews/pending',     auth, getPendingReviews);
router.patch('/import/reviews/:id',       auth, resolveReview);

module.exports = router;
