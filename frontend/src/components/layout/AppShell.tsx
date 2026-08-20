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
  Plus,
  Repeat,
  ScanLine,
  ScrollText,
  Settings as SettingsIcon,
  Tag,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet } from 'react-router-dom';

import brandMark from '@/assets/brand-mark.webp';
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

/**
 * Sidebar grouping (display only — applied AFTER permission/plan filtering,
 * so it never changes which items render). `/` stays unsectioned on top.
 * Keys translate under `nav.sections.*`.
 */
const NAV_SECTION_ORDER = ['sales', 'catalog', 'manage'] as const;
type NavSectionKey = (typeof NAV_SECTION_ORDER)[number];

const NAV_SECTION_BY_PATH: Record<string, NavSectionKey> = {
  '/billing': 'sales',
  '/billing/simple': 'sales',
  '/payments': 'sales',
  '/ledgers': 'sales',
  '/returns': 'sales',
  '/exchanges': 'sales',
  '/catalog': 'catalog',
  '/pricing': 'catalog',
  '/stock': 'catalog',
  '/stock/transfers': 'catalog',
  '/purchasing': 'catalog',
  '/customers': 'manage',
  '/expenses': 'manage',
  '/reports': 'manage',
  '/audit': 'manage',
  '/settings': 'manage',
  '/settings/staff': 'manage',
};

/**
 * Mobile bottom tab bar: counter-critical screens + a raised center FAB for
 * "new sale" + a More sheet. Billing itself is the FAB, not a tab.
 */
const MOBILE_TABS_BEFORE_FAB = ['/', '/stock'] as const;
const MOBILE_TABS_AFTER_FAB = ['/reports'] as const;

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

function PoweredBy({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <p
      className={cn(
        'flex items-center justify-center gap-1 text-[11px] text-muted-foreground/70',
        className,
      )}
    >
      <img src={brandMark} alt="" className="h-3.5 w-3.5" />
      {t('nav.poweredBy', { brand: 'mero-pasal.online' })}
    </p>
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
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground shadow-sm'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )
      }
    >
      <item.icon className="h-4 w-4 shrink-0" />
      {t(`nav.${item.labelKey}`)}
    </NavLink>
  );
}

/** Sectioned sidebar nav: dashboard on top, then labeled groups. */
function SideNav({ items }: { items: NavItem[] }) {
  const { t } = useTranslation();
  const topItems = items.filter((item) => !NAV_SECTION_BY_PATH[item.to]);
  return (
    <nav className="flex-1 space-y-4 overflow-y-auto p-3">
      {topItems.length > 0 ? (
        <div className="space-y-0.5">
          {topItems.map((item) => (
            <SideNavLink key={item.to} item={item} />
          ))}
        </div>
      ) : null}
      {NAV_SECTION_ORDER.map((section) => {
        const sectionItems = items.filter((item) => NAV_SECTION_BY_PATH[item.to] === section);
        if (sectionItems.length === 0) {
          return null;
        }
        return (
          <div key={section}>
            <p className="px-3 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
              {t(`nav.sections.${section}`)}
            </p>
            <div className="space-y-0.5">
              {sectionItems.map((item) => (
                <SideNavLink key={item.to} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

/** Mobile "More" sheet: the full nav, workspace selector, and sign out. */
function MoreSheet({
  items,
  userName,
  shopName,
  onSignOut,
}: {
  items: NavItem[];
  userName: string | undefined;
  shopName: string | undefined;
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
          <SheetTitle className="truncate text-base font-bold">{shopName}</SheetTitle>
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
                  'flex items-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium',
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
        <PoweredBy className="mt-3" />
      </SheetContent>
    </Sheet>
  );
}

function MobileTab({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  return (
    <NavLink
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
  );
}

/**
 * Raised center FAB in the mobile tab bar — the counter's "new sale" action.
 * Targets billingPath(user), so it follows the tenant's POS plan mode.
 */
function NewSaleFab() {
  const { user } = useAuth();
  const { t } = useTranslation();
  return (
    <div className="relative flex-1">
      <Link
        to={billingPath(user)}
        aria-label={t('nav.newSale')}
        className={cn(
          'absolute -top-5 left-1/2 flex h-14 w-14 -translate-x-1/2 items-center justify-center',
          'rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background',
          'transition-transform active:scale-95',
        )}
      >
        <Plus className="h-7 w-7" />
      </Link>
    </div>
  );
}

/**
 * Authenticated tenant app shell: slim sectioned sidebar on desktop, top bar
 * + bottom tab bar with a center new-sale FAB on mobile.
 */
export function AppShell() {
  const { user, signOut } = useAuth();
  const { t } = useTranslation();
  const items = useVisibleNavItems();
  const tabsBeforeFab = items.filter((item) =>
    (MOBILE_TABS_BEFORE_FAB as readonly string[]).includes(item.to),
  );
  const tabsAfterFab = items.filter((item) =>
    (MOBILE_TABS_AFTER_FAB as readonly string[]).includes(item.to),
  );

  return (
    <div className="min-h-screen bg-muted/40">
      <SupportAccessBanner onEnded={signOut} />

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r bg-background md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <span className="truncate text-base font-bold tracking-tight">{user?.shop_name}</span>
        </div>
        <SideNav items={items} />
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
          <PoweredBy />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background px-4 md:hidden">
        <span className="max-w-48 truncate text-base font-bold tracking-tight">
          {user?.shop_name}
        </span>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <span className="max-w-40 truncate text-sm text-muted-foreground">
            {user?.full_name}
          </span>
        </div>
      </header>

      <main className="pb-24 md:pb-8 md:pl-60">
        <Outlet />
      </main>

      {/* Mobile bottom tab bar with center new-sale FAB */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t bg-background md:hidden">
        {tabsBeforeFab.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
        <NewSaleFab />
        {tabsAfterFab.map((item) => (
          <MobileTab key={item.to} item={item} />
        ))}
        <MoreSheet
          items={items}
          userName={user?.full_name}
          shopName={user?.shop_name}
          onSignOut={signOut}
        />
      </nav>
    </div>
  );
}
