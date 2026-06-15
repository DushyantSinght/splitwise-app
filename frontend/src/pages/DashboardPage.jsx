import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getGroups, createGroup } from '../services/api';

export default function DashboardPage() {
  const [groups, setGroups] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const fetchGroups = async () => {
    try {
      const res = await getGroups();
      setGroups(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGroups(); }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    setCreating(true);
    try {
      await createGroup({ name: newGroupName.trim() });
      setNewGroupName('');
      setShowCreate(false);
      fetchGroups();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Your Groups</h1>
          <p className="text-gray-500 text-sm mt-1">Select a group to view expenses and balances</p>
        </div>
        <div className="flex gap-3">
          <Link to="/import" className="btn-secondary flex items-center gap-2">
            📥 Import CSV
          </Link>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
            + New Group
          </button>
        </div>
      </div>

      {showCreate && (
        <div className="card mb-6 border-l-4 border-indigo-500">
          <h3 className="font-semibold mb-3">Create New Group</h3>
          <form onSubmit={handleCreate} className="flex gap-3">
            <input className="input flex-1" placeholder="e.g. Flat – Feb 2026"
              value={newGroupName} onChange={e => setNewGroupName(e.target.value)} autoFocus />
            <button className="btn-primary" disabled={creating}>{creating ? 'Creating…' : 'Create'}</button>
            <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading groups…</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">🏠</div>
          <h3 className="text-lg font-medium text-gray-700">No groups yet</h3>
          <p className="text-gray-400 mt-2">Create a group or import your flatmates' CSV to get started.</p>
          <div className="flex gap-3 justify-center mt-6">
            <button onClick={() => setShowCreate(true)} className="btn-primary">+ Create Group</button>
            <Link to="/import" className="btn-secondary">📥 Import CSV</Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {groups.map(group => (
            <Link key={group.id} to={`/groups/${group.id}`}
              className="card hover:shadow-md transition cursor-pointer border-l-4 border-indigo-500">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">{group.name}</h3>
                  <p className="text-gray-400 text-sm mt-1">
                    {group.active_member_count} active member{group.active_member_count !== 1 ? 's' : ''}
                  </p>
                </div>
                <span className="text-gray-300 text-xl">→</span>
              </div>
              <p className="text-xs text-gray-400 mt-3">
                Created {new Date(group.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
