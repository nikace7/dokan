import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

const navClass = ({ isActive }: { isActive: boolean }) =>
  [
    'rounded-md px-3 py-2 text-sm font-medium',
    isActive ? 'bg-slate-100 text-slate-950' : 'text-slate-300 hover:bg-slate-800 hover:text-white',
  ].join(' ');

export function AdminLayout() {
  const auth = usePlatformAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-slate-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="font-semibold">Dokan control plane</span>
            <nav aria-label="Platform administration" className="flex items-center gap-1">
              <NavLink to="/admin/tenants" className={navClass}>
                Tenants
              </NavLink>
              <NavLink to="/admin/plans" className={navClass}>
                Plans
              </NavLink>
              {auth.user?.role === 'SUPER_ADMIN' ? (
                <NavLink to="/admin/audit" className={navClass}>
                  Audit
                </NavLink>
              ) : null}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-300">
              {auth.user?.full_name} · {auth.user?.role}
            </span>
            <button
              type="button"
              className="rounded-md px-3 py-2 text-slate-300 hover:bg-slate-800 hover:text-white"
              onClick={() => {
                auth.signOut();
                navigate('/admin/login', { replace: true });
              }}
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
