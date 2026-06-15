import { useState, useRef } from 'react';
import { importCSV, getImportReport } from '../services/api';

const ANOMALY_LABELS = {
  A01: { label: 'Exact Duplicate', color: 'badge-red' },
  A02: { label: 'Comma in Amount', color: 'badge-yellow' },
  A03: { label: 'Excess Precision', color: 'badge-yellow' },
  A04: { label: 'Name Capitalisation', color: 'badge-yellow' },
  A05: { label: 'Name Variant', color: 'badge-yellow' },
  A06: { label: 'Missing Payer', color: 'badge-red' },
  A07: { label: 'Settlement as Expense', color: 'badge-yellow' },
  A08: { label: 'Bad Percentages', color: 'badge-red' },
  A09: { label: 'USD Currency', color: 'badge-yellow' },
  A10: { label: 'Negative Amount (Refund)', color: 'badge-yellow' },
  A11: { label: 'Non-standard Date', color: 'badge-yellow' },
  A12: { label: 'Missing Currency', color: 'badge-yellow' },
  A13: { label: 'Zero Amount', color: 'badge-gray' },
  A14: { label: 'Ambiguous Date', color: 'badge-red' },
  A15: { label: 'Inactive Member in Split', color: 'badge-red' },
  A16: { label: 'Unknown Guest in Split', color: 'badge-yellow' },
  A17: { label: 'Conflicting Duplicate', color: 'badge-red' },
  A18: { label: 'Split Type Contradiction', color: 'badge-yellow' },
  A19: { label: 'Deposit Payment', color: 'badge-yellow' },
  DB_ERROR: { label: 'DB Error', color: 'badge-red' },
};

function AnomalyTag({ code }) {
  const info = ANOMALY_LABELS[code] || { label: code, color: 'badge-gray' };
  return <span className={info.color}>{info.label}</span>;
}

function StatusBadge({ status }) {
  const map = {
    imported: 'badge-green',
    flagged: 'badge-yellow',
    skipped: 'badge-red',
  };
  return <span className={map[status] || 'badge-gray'}>{status}</span>;
}

export default function ImportPage() {
  const [file, setFile] = useState(null);
  const [importing, setImporting] = useState(false);
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const fileRef = useRef();

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError('');
    setReport(null);
    try {
      const res = await importCSV(file);
      setReport(res.data.report);
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const anomalousRows = report?.rows.filter(r => r.anomalies.length > 0) || [];

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">📥 Import CSV</h1>
        <p className="text-gray-500 text-sm mt-1">
          Upload <code className="bg-gray-100 px-1 rounded">expenses_export.csv</code>. 
          Every anomaly is detected, surfaced, and handled per documented policy.
        </p>
      </div>

      {/* Upload zone */}
      <div className="card mb-6">
        <div
          className="border-2 border-dashed border-gray-200 rounded-xl p-10 text-center cursor-pointer hover:border-indigo-400 transition"
          onClick={() => fileRef.current.click()}>
          <div className="text-4xl mb-3">📂</div>
          <p className="font-medium text-gray-700">
            {file ? file.name : 'Click to select CSV file'}
          </p>
          <p className="text-xs text-gray-400 mt-1">expenses_export.csv</p>
          <input ref={fileRef} type="file" accept=".csv" className="hidden"
            onChange={e => { setFile(e.target.files[0]); setReport(null); }} />
        </div>

        {file && (
          <div className="mt-4 flex gap-3">
            <button className="btn-primary" onClick={handleImport} disabled={importing}>
              {importing ? '⏳ Importing…' : '🚀 Run Import'}
            </button>
            <button className="btn-secondary" onClick={() => { setFile(null); setReport(null); }}>
              Clear
            </button>
          </div>
        )}

        {error && (
          <div className="mt-4 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-lg">{error}</div>
        )}
      </div>

      {/* Import report */}
      {report && (
        <div className="space-y-6">
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Total Rows', value: report.totalRows, color: 'text-gray-900' },
              { label: 'Imported', value: report.imported, color: 'text-green-700' },
              { label: 'Flagged', value: report.flagged, color: 'text-yellow-700' },
              { label: 'Skipped', value: report.skipped, color: 'text-red-700' },
            ].map(s => (
              <div key={s.label} className="card text-center">
                <div className={`text-3xl font-bold ${s.color}`}>{s.value}</div>
                <div className="text-xs text-gray-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>

          <div className="card bg-blue-50 border border-blue-100">
            <p className="text-sm text-blue-800">
              💱 USD conversion rate used: <strong>1 USD = ₹{report.usdRateUsed}</strong>
              {' · '}
              {report.pendingReview} row{report.pendingReview !== 1 ? 's' : ''} pending manual review
              {report.pendingReview > 0 && (
                <a href="/reviews" className="ml-2 underline">→ Go to Reviews</a>
              )}
            </p>
          </div>

          {/* Anomaly log table */}
          <div className="card">
            <h3 className="font-semibold text-gray-900 mb-4">
              🔍 Anomaly Log ({anomalousRows.length} rows with issues)
            </h3>
            <div className="space-y-3 max-h-[600px] overflow-y-auto">
              {anomalousRows.map(row => (
                <div key={row.rowNumber} className="border border-gray-100 rounded-lg p-4">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">Row {row.rowNumber}</span>
                      <span className="font-medium text-gray-800 text-sm">
                        {row.original?.description}
                      </span>
                    </div>
                    <StatusBadge status={row.status} />
                  </div>
                  <div className="text-xs text-gray-500 mb-2">
                    {row.original?.date} · {row.original?.paid_by} · {row.original?.amount} {row.original?.currency}
                  </div>
                  <div className="space-y-1.5">
                    {row.anomalies.map((a, i) => (
                      <div key={i} className="bg-gray-50 rounded-lg px-3 py-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <AnomalyTag code={a.code} />
                          <span className="text-xs text-gray-600">{a.message}</span>
                        </div>
                        <div className="text-xs text-indigo-600 mt-1 pl-1">
                          → {a.resolution}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Full row log */}
          <details className="card cursor-pointer">
            <summary className="font-semibold text-gray-700 select-none">
              📄 Full Row-by-Row Log ({report.rows.length} rows)
            </summary>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left border-b border-gray-100">
                    <th className="py-2 pr-4 text-gray-500">Row</th>
                    <th className="py-2 pr-4 text-gray-500">Description</th>
                    <th className="py-2 pr-4 text-gray-500">Amount</th>
                    <th className="py-2 pr-4 text-gray-500">Status</th>
                    <th className="py-2 text-gray-500">Anomalies</th>
                  </tr>
                </thead>
                <tbody>
                  {report.rows.map(row => (
                    <tr key={row.rowNumber} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-4 font-mono text-gray-400">{row.rowNumber}</td>
                      <td className="py-2 pr-4 text-gray-800 max-w-[200px] truncate">{row.original?.description}</td>
                      <td className="py-2 pr-4 text-gray-600">{row.original?.amount} {row.original?.currency}</td>
                      <td className="py-2 pr-4"><StatusBadge status={row.status} /></td>
                      <td className="py-2">
                        <div className="flex gap-1 flex-wrap">
                          {row.anomalies.map((a, i) => <AnomalyTag key={i} code={a.code} />)}
                          {row.anomalies.length === 0 && <span className="text-green-500">✓</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}
