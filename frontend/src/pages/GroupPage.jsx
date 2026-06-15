import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { getGroup, getBalances, getExpenses, getMemberExpenses, recordSettlement, deleteExpense } from '../services/api';

function fmt(n) {
  return '₹' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function BalancePanel({ groupId }) {
  const [data, setData] = useState(null);
  const [selectedMember, setSelectedMember] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);
  const [group, setGroup] = useState(null);
  const [settling, setSettling] = useState(null);

  useEffect(() => {
    getBalances(groupId).then(r => setData(r.data));
    getGroup(groupId).then(r => setGroup(r.data));
  }, [groupId]);

  const loadBreakdown = async (member) => {
    if (!group) return;
    const m = group.members.find(m => m.name === member);
    if (!m) return;
    setSelectedMember(member);
    setLoadingBreakdown(true);
    try {
      const res = await getMemberExpenses(groupId, m.id);
      setBreakdown(res.data);
    } finally {
      setLoadingBreakdown(false);
    }
  };

  const handleSettle = async (txn) => {
    if (!group) return;
    const from = group.members.find(m => m.name === txn.from);
    const to = group.members.find(m => m.name === txn.to);
    if (!from || !to) return alert('Member not found');
    setSettling(txn);
    try {
      await recordSettlement(groupId, {
        paid_by: from.id, paid_to: to.id,
        amount: txn.amount, currency: 'INR',
        settled_at: new Date().toISOString().split('T')[0]
      });
      const res = await getBalances(groupId);
      setData(res.data);
      alert('Settlement recorded!');
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to record settlement');
    } finally {
      setSettling(null);
    }
  };

  if (!data) return <div className="text-gray-400 text-sm py-4">Calculating balances…</div>;

  const { balances, settlements } = data;

  return (
    <div className="space-y-6">
      {/* Summary: who pays whom */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">💰 Who Pays Whom</h3>
        {settlements.length === 0 ? (
          <div className="text-green-600 font-medium text-sm flex items-center gap-2">
            ✅ All settled up!
          </div>
        ) : (
          <div className="space-y-3">
            {settlements.map((txn, i) => (
              <div key={i} className="flex items-center justify-between bg-orange-50 rounded-lg px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-semibold text-red-600">{txn.from}</span>
                  <span className="text-gray-400">→ pays →</span>
                  <span className="font-semibold text-green-700">{txn.to}</span>
                  <span className="font-bold text-gray-900 ml-2">{fmt(txn.amount)}</span>
                </div>
                <button
                  className="text-xs btn-secondary py-1 px-3"
                  disabled={settling === txn}
                  onClick={() => handleSettle(txn)}>
                  {settling === txn ? '…' : 'Mark paid'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Individual balances */}
      <div className="card">
        <h3 className="font-semibold text-gray-900 mb-4">📊 Individual Balances</h3>
        <div className="space-y-2">
          {Object.entries(balances).sort((a, b) => b[1] - a[1]).map(([name, bal]) => (
            <div key={name}
              className={`flex items-center justify-between px-4 py-3 rounded-lg cursor-pointer hover:opacity-80 transition ${bal >= 0 ? 'bg-green-50' : 'bg-red-50'}`}
              onClick={() => loadBreakdown(name)}>
              <span className="font-medium text-gray-800">{name}</span>
              <div className="flex items-center gap-3">
                <span className={`font-bold ${bal >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {bal >= 0 ? '+' : '-'}{fmt(bal)}
                </span>
                <span className="text-xs text-gray-400">
                  {bal >= 0 ? 'is owed' : 'owes'}
                </span>
                <span className="text-gray-300">›</span>
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-3">Click a member to see their expense breakdown</p>
      </div>

      {/* Member breakdown — Rohan's requirement */}
      {selectedMember && (
        <div className="card border-l-4 border-indigo-500">
          <h3 className="font-semibold text-gray-900 mb-4">
            🔎 Breakdown for {selectedMember}
          </h3>
          {loadingBreakdown ? <p className="text-gray-400 text-sm">Loading…</p> : breakdown && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-600 mb-2">Expenses they owe a share of:</h4>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {breakdown.owes.map(e => (
                    <div key={e.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50">
                      <div>
                        <span className="text-gray-800">{e.description}</span>
                        <span className="text-gray-400 ml-2 text-xs">
                          {new Date(e.expense_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                        </span>
                        {e.currency !== 'INR' && (
                          <span className="ml-1 badge-yellow">{e.currency}</span>
                        )}
                      </div>
                      <span className="text-red-600 font-medium">{fmt(e.share_amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-600 mb-2">Expenses they paid for:</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {breakdown.paid.map(e => (
                    <div key={e.id} className="flex justify-between text-sm py-1.5 border-b border-gray-50">
                      <span className="text-gray-800">{e.description}</span>
                      <span className="text-green-600 font-medium">{fmt(e.amount_inr)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExpenseList({ groupId }) {
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchExpenses = async () => {
    try {
      const res = await getExpenses(groupId);
      setExpenses(res.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchExpenses(); }, [groupId]);

  const handleDelete = async (id) => {
    if (!confirm('Soft-delete this expense? (Can be reviewed and restored)')) return;
    await deleteExpense(id);
    fetchExpenses();
  };

  if (loading) return <div className="text-gray-400 text-sm py-4">Loading expenses…</div>;

  return (
    <div className="card">
      <h3 className="font-semibold text-gray-900 mb-4">📋 All Expenses ({expenses.length})</h3>
      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {expenses.map(e => (
          <div key={e.id} className="border border-gray-100 rounded-lg px-4 py-3 hover:bg-gray-50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-gray-900 text-sm">{e.description}</span>
                  {e.is_settlement && <span className="badge-yellow">settlement</span>}
                  {e.currency !== 'INR' && (
                    <span className="badge-green">{e.currency} {e.original_amount}</span>
                  )}
                </div>
                <div className="text-xs text-gray-400 mt-1">
                  Paid by <span className="font-medium text-gray-600">{e.paid_by_name}</span>
                  {' · '}
                  {new Date(e.expense_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  {' · '}
                  <span className="capitalize">{e.split_type} split</span>
                </div>
                {/* Splits */}
                {e.splits && e.splits[0]?.user_id && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {e.splits.filter(s => s.user_id).map(s => (
                      <span key={s.user_id} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {s.name}: ₹{parseFloat(s.share_amount || 0).toFixed(0)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-bold text-gray-900">
                  ₹{parseFloat(e.amount_inr).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </div>
                <button onClick={() => handleDelete(e.id)}
                  className="text-xs text-red-400 hover:text-red-600 mt-1">delete</button>
              </div>
            </div>
            {e.notes && (
              <div className="text-xs text-gray-400 italic mt-1.5 border-t border-gray-50 pt-1.5">
                💬 {e.notes}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function GroupPage() {
  const { id } = useParams();
  const [group, setGroup] = useState(null);
  const [tab, setTab] = useState('balances');

  useEffect(() => {
    getGroup(id).then(r => setGroup(r.data));
  }, [id]);

  if (!group) return <div className="p-8 text-gray-400">Loading…</div>;

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{group.name}</h1>
        <div className="flex gap-2 flex-wrap mt-2">
          {group.members.map(m => (
            <span key={m.id} className={`text-xs px-2.5 py-1 rounded-full font-medium ${m.left_at ? 'bg-gray-100 text-gray-400' : 'bg-indigo-100 text-indigo-700'}`}>
              {m.name}
              {m.left_at && ' (left)'}
            </span>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-lg w-fit">
        {['balances', 'expenses'].map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition capitalize ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t === 'balances' ? '💰 Balances' : '📋 Expenses'}
          </button>
        ))}
      </div>

      {tab === 'balances' && <BalancePanel groupId={id} />}
      {tab === 'expenses' && <ExpenseList groupId={id} />}
    </div>
  );
}
