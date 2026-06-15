import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export default function Layout() {
  const { user, logoutUser } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => { logoutUser(); navigate('/login'); };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-60 bg-indigo-900 text-white flex flex-col">
        <div className="px-6 py-5 border-b border-indigo-800">
          <h1 className="text-xl font-bold tracking-tight">💸 SplitRight</h1>
          <p className="text-indigo-300 text-xs mt-1">Shared Expenses</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          <NavLink to="/" end className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${isActive ? 'bg-indigo-700 text-white' : 'text-indigo-200 hover:bg-indigo-800'}`}>
            🏠 Dashboard
          </NavLink>
          <NavLink to="/import" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${isActive ? 'bg-indigo-700 text-white' : 'text-indigo-200 hover:bg-indigo-800'}`}>
            📥 Import CSV
          </NavLink>
          <NavLink to="/reviews" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${isActive ? 'bg-indigo-700 text-white' : 'text-indigo-200 hover:bg-indigo-800'}`}>
            🔍 Pending Reviews
          </NavLink>
        </nav>

        <div className="px-4 py-4 border-t border-indigo-800">
          <div className="text-sm text-indigo-200 mb-2 truncate">👤 {user?.name}</div>
          <button onClick={handleLogout} className="text-xs text-indigo-400 hover:text-white transition">
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
