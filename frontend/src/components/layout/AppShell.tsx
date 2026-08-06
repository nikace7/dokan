import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  Repeat,
  ScanLine,
  ScrollText,
  Settings as SettingsIcon,
  Store,
  Tag,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router-dom';

import { LanguageToggle } from '@/components/layout/LanguageToggle';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { useAuth } from '@/features/auth/useAuth';
import { WorkspaceSelector } from '@/features/settings/WorkspaceSelector';
import { SupportAccessBanner } from '@/features/support/SupportAccessBanner';
import { hasPermission } from '@/lib/permissions';
import type { PermissionCodename } from '@/lib/permissions';
import { hasPlanFeature } from '@/lib/plans';
import { billingPath } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  /** Translation key under `nav.*` (see src/lib/i18n). */
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  /** Any one of these permissions suffices (UI visibility only). */
  anyOf?: PermissionCodename[];
  /** Plan feature gate (UI visibility only; the API enforces for real). */
  feature?: PlanFeature;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/billing', labelKey: 'billing', icon: ScanLine },
  { to: '/catalog', labelKey: 'catalog', icon: Package },
  { to: '/pricing', labelKey: 'pricing', icon: Tag, anyOf: ['pricing.view'] },
  { to: '/customers', labelKey: 'customers', icon: Users, anyOf: ['customer.view'] },
  { to: '/stock', labelKey: 'stock', icon: Boxes, anyOf: ['stock.view'], end: true },
  {
    to: '/stock/transfers',
    labelKey: 'transfers',
    icon: ArrowLeftRight,
    anyOf: ['stock.view'],
    feature: 'multi_branch',
  },
  { to: '/purchasing', labelKey: 'purchasing', icon: Truck },
  { to: '/expenses', labelKey: 'expenses', icon: Wallet },
  { to: '/payments', labelKey: 'payments', icon: Banknote },
  { to: '/ledgers', labelKey: 'ledgers', icon: BookOpen },
  { to: '/returns', labelKey: 'returns', icon: Undo2 },
  { to: '/exchanges', labelKey: 'exchanges', icon: Repeat },
  { to: '/reports', labelKey: 'reports', icon: BarChart3 },
  { to: '/audit', labelKey: 'audit', icon: ScrollText, anyOf: ['settings.manage'] },
  {
    to: '/settings',
    labelKey: 'settings',
    icon: SettingsIcon,
    anyOf: ['settings.manage', 'user.manage'],
  },
];

/** Mobile bottom tab bar: the four counter-critical screens + a More sheet. */
const MOBILE_TABS = ['/', '/billing', '/billing/simple', '/stock', '/reports'] as const;

function useVisibleNavItems(): NavItem[] {
  const { user } = useAuth();
  return NAV_ITEMS.filter((item) => {
    if (item.anyOf && !item.anyOf.some((codename) => hasPermission(user, codename))) {
      return false;
    }
    if (item.feature && !hasPlanFeature(user, item.feature)) {
      return false;
    }
    return true;
  }).map((item) => {
    // Staff managers without settings.manage land on the staff screen
    // directly (matches the old header nav behavior).
    if (item.to === '/settings' && !hasPermission(user, 'settings.manage')) {
      return { ...item, to: '/settings/staff' };
    }
    // The classic barcode POS exists only with advanced_pos; otherwise the
    // Billing entry opens the simple sale screen.
    if (item.to === '/billing') {
      return { ...item, to: billingPath(user) };
    }
    return item;
  });
}

function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('flex items-center gap-2 font-bold text-foreground', className)}>
      <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <Store className="h-4 w-4" />
      </span>
      <span className="text-lg">दोकान</span>
    </span>
  );
}

function SideNavLink({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {t(`nav.${item.labelKey}`)}
    </NavLink>
  );
}

/** Mobile "More" sheet: the full nav, workspace selector, and sign out. */
function MoreSheet({
  items,
  userName,
  onSignOut,
}: {
  items: NavItem[];
  userName: string | undefined;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium text-muted-foreground"
          aria-label={t('nav.moreNavigation')}
        >
          <Menu className="h-5 w-5" />
          {t('nav.more')}
        </button>
      </SheetTrigger>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <BrandMark className="text-base" />
          </SheetTitle>
        </SheetHeader>
        <nav className="mt-4 grid grid-cols-2 gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-md px-3 py-2.5 text-sm font-medium',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <item.icon className="h-4 w-4 shrink-0" />
              {t(`nav.${item.labelKey}`)}
            </NavLink>
          ))}
        </nav>
        <div className="mt-4 border-t pt-4">
          <WorkspaceSelector />
        </div>
        <div className="mt-4 flex items-center justify-between border-t pt-4">
          <span className="text-sm text-muted-foreground">{userName}</span>
          <button
            type="button"
            onClick={onSignOut}
            className="flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
          >
            <LogOut className="h-4 w-4" />
            {t('nav.signOut')}
          </button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Authenticated tenant app shell: slim sidebar on desktop, top bar + bottom
 * tab bar on mobile. Replaces the old single-row header nav, which no longer
 * fit the growing route list.
 */
export function AppShell() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const items = useVisibleNavItems();
  const tabs = items.filter((item) =>
    (MOBILE_TABS as readonly string[]).includes(item.to),
  );

  return (
    <div className="min-h-screen bg-muted/40">
      <SupportAccessBanner onEnded={signOut} />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <BrandMark />
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => (
            <SideNavLink key={item.to} item={item} />
          ))}
        </nav>
        <div className="space-y-3 border-t p-3">
          <WorkspaceSelector />
          <LanguageToggle />
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-sm text-muted-foreground">{user?.full_name}</span>
            <button
              type="button"
              onClick={signOut}
              aria-label={t('nav.signOut')}
              className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <BrandMark />
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <span className="max-w-40 truncate text-sm text-muted-foreground">
            {user?.full_name}
          </span>
        </div>
      </header>

      <main className="pb-20 md:pb-8 md:pl-60">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background md:hidden">
        {tabs.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-1 flex-col items-center gap-1 py-2 text-xs font-medium',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )
            }
          >
            <item.icon className="h-5 w-5" />
            {t(`nav.${item.labelKey}`)}
          </NavLink>
        ))}
        <MoreSheet items={items} userName={user?.full_name} onSignOut={signOut} />
      </nav>
    </div>
  );
}
