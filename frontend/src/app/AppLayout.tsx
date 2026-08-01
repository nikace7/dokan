import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '@/features/auth/useAuth';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium',
    isActive ? 'bg-blue-700 text-white' : 'text-slate-200 hover:bg-blue-800 hover:text-white',
  ].join(' ');

/** Authenticated shell: top nav, current user, sign out. */
export function AppLayout() {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-blue-900 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-6">
            <span className="text-lg font-bold">दोकान</span>
            <nav className="flex items-center gap-1">
              <NavLink to="/billing" className={navLinkClass}>
                Billing / बिलिङ
              </NavLink>
              <NavLink to="/catalog" className={navLinkClass}>
                Catalog
              </NavLink>
              <NavLink to="/stock" className={navLinkClass}>
                Stock
              </NavLink>
              <NavLink to="/purchasing" className={navLinkClass}>
                Purchasing
              </NavLink>
              <NavLink to="/reports" className={navLinkClass}>
                Reports
              </NavLink>
              <NavLink to="/" end className={navLinkClass}>
                Dashboard
              </NavLink>
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">{user?.full_name}</span>
            <button
              type="button"
              onClick={signOut}
              className="rounded-md px-2 py-1 text-slate-200 hover:bg-blue-800 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <Outlet />
    </div>
  );
}
