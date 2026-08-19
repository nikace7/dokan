import { Building2, Layers, LogOut, ScrollText } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';

import brandMark from '@/assets/brand-mark.webp';
import { Badge } from '@/components/ui/badge';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';
import { cn } from '@/lib/utils';

interface AdminNavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Visible to SUPER_ADMIN only (mirrors PlatformAuditRoute in router.tsx). */
  superAdminOnly?: boolean;
}

const NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin/tenants', label: 'Tenants', icon: Building2 },
  { to: '/admin/plans', label: 'Plans', icon: Layers },
  { to: '/admin/audit', label: 'Audit', icon: ScrollText, superAdminOnly: true },
];

function navLinkClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
    isActive
      ? 'bg-accent text-accent-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );
}

function BrandMark() {
  return (
    <span className="flex items-center gap-2 font-bold text-foreground">
      <img src={brandMark} alt="" className="h-8 w-8" />
      <span className="text-lg">mero-pasal Control</span>
    </span>
  );
}

/**
 * Platform-admin shell: fixed sidebar on desktop, top bar + horizontal nav
 * on mobile. Feature pages render their own `<main>` containers inside the
 * `<Outlet/>`. English only — the admin portal has no i18n.
 */
export function AdminLayout() {
  const auth = usePlatformAuth();
  const navigate = useNavigate();
  const items = NAV_ITEMS.filter(
    (item) => !item.superAdminOnly || auth.user?.role === 'SUPER_ADMIN',
  );

  const signOut = () => {
    auth.signOut();
    navigate('/admin/login', { replace: true });
  };

  const userBlock = (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 space-y-0.5">
        <p className="truncate text-sm font-medium text-foreground">{auth.user?.full_name}</p>
        <p className="truncate text-xs text-muted-foreground">{auth.user?.email}</p>
      </div>
      {auth.user?.role ? (
        <Badge variant="outline" className="shrink-0">
          {auth.user.role.replace('_', ' ')}
        </Badge>
      ) : null}
      <button
        type="button"
        onClick={signOut}
        aria-label="Sign out"
        className="shrink-0 rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <BrandMark />
        </div>
        <nav aria-label="Platform administration" className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t p-3">{userBlock}</div>
      </aside>

      {/* Mobile top bar + horizontal nav */}
      <header className="sticky top-0 z-30 border-b bg-background md:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <BrandMark />
          <div className="flex items-center gap-2">
            {auth.user?.role ? (
              <Badge variant="outline">{auth.user.role.replace('_', ' ')}</Badge>
            ) : null}
            <button
              type="button"
              onClick={signOut}
              aria-label="Sign out"
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        <nav
          aria-label="Platform administration"
          className="flex items-center gap-1 overflow-x-auto px-3 pb-2"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {/* Pages render their own <main> containers. */}
      <div className="md:pl-60">
        <Outlet />
      </div>
    </div>
  );
}
