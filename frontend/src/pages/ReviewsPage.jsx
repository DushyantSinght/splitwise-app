import { useState, useEffect } from 'react';
import { getPendingReviews, resolveReview } from '../services/api';

const CODE_DESCRIPTIONS = {
  A01: 'Exact duplicate row — proposed to skip',
  A07: 'Settlement logged as expense',
  A08: 'Percentage split does not sum to 100%',
  A14: 'Ambiguous date format',
  A17: 'Conflicting duplicate (same event, different data)',
  A19: 'Deposit payment between members',
};

export default function ReviewsPage() {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);

  const fetchReviews = async () => {
    try {
      const res = await getPendingReviews();
      setReviews(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchReviews(); }, []);

  const handleResolve = async (id, decision) => {
    setProcessing(id + decision);
    try {
      await resolveReview(id, decision);
      fetchReviews();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to resolve');
    } finally {
      setProcessing(null);
    }
  };

  if (loading) return <div className="p-8 text-gray-400">Loading reviews…</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">🔍 Pending Reviews</h1>
        <p className="text-gray-500 text-sm mt-1">
          These rows were flagged during import and need a human decision.
          Approve or reject each proposed action.
        </p>
      </div>

      {reviews.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-4xl mb-4">✅</div>
          <h3 className="text-lg font-medium text-gray-700">No pending reviews</h3>
          <p className="text-gray-400 mt-2">All flagged items have been resolved.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map(review => {
            const raw = review.raw_data;
            const codes = (review.review_type || '').split(',').filter(Boolean);
            return (
              <div key={review.id} className="card border-l-4 border-yellow-400">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-mono text-xs text-gray-400">CSV Row {review.csv_row}</span>
                      {codes.map(c => (
                        <span key={c} className="badge-yellow">{c}</span>
                      ))}
                    </div>
                    <h3 className="font-semibold text-gray-900">{review.description}</h3>

                    {/* Raw data preview */}
                    {raw && (
                      <div className="mt-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <div><span className="font-medium">Date:</span> {raw.date}</div>
                        <div><span className="font-medium">Paid by:</span> {raw.paid_by}</div>
                        <div><span className="font-medium">Amount:</span> {raw.amount} {raw.currency}</div>
                        {raw.notes && <div><span className="font-medium">Note:</span> {raw.notes}</div>}
                      </div>
                    )}

                    <div className="mt-3 bg-indigo-50 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-indigo-700">Proposed action:</span>
                      <div className="text-indigo-800 mt-0.5">{review.proposed_action}</div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-4">
                  <button
                    className="btn-primary py-1.5 text-sm"
                    disabled={!!processing}
                    onClick={() => handleResolve(review.id, 'approved')}>
                    {processing === review.id + 'approved' ? '…' : '✓ Approve'}
                  </button>
                  <button
                    className="btn-danger py-1.5 text-sm"
                    disabled={!!processing}
                    onClick={() => handleResolve(review.id, 'rejected')}>
                    {processing === review.id + 'rejected' ? '…' : '✗ Reject'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
