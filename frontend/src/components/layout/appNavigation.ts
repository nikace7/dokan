import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  LayoutDashboard,
  Package,
  ReceiptText,
  Repeat,
  ScanLine,
  ScrollText,
  ShoppingBag,
  ShieldCheck,
  Settings,
  Tag,
  Truck,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import { useAuth } from '@/features/auth/useAuth';
import { hasPermission } from '@/lib/permissions';
import type { PermissionCodename, PermissionUser } from '@/lib/permissions';
import { billingPath, hasPlanFeature } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  feature?: PlanFeature;
}

const REPORT_VIEW_CODES: PermissionCodename[] = [
  'report.sales',
  'report.staff',
  'report.stock',
  'report.profit',
  'report.ledger',
  'report.cash',
  'report.vat',
  'report.expense',
];

/**
 * Who may open each page: any one of these permissions. The single source for
 * both the sidebar and the route guard, so a page is either listed and usable
 * or hidden and blocked. Mirrors each page's backend GET permission. Paths not
 * listed (dashboard, own security settings) are open to every signed-in user.
 */
export const ROUTE_ACCESS: Readonly<Record<string, readonly PermissionCodename[]>> = {
  '/billing': ['sale.create'],
  '/billing/simple': ['sale.create'],
  '/bills': ['sale.view'],
  '/bills/:id': ['sale.view'],
  '/online-orders': ['sale.view'],
  '/catalog': ['catalog.view'],
  '/catalog/items/new': ['catalog.manage'],
  '/catalog/items/:id': ['catalog.view'],
  '/catalog/items/:id/edit': ['catalog.manage'],
  '/pricing': ['pricing.view'],
  '/customers': ['customer.view'],
  '/stock': ['stock.view'],
  '/stock/transfers': ['stock.view'],
  '/stock/counts': ['stock.view'],
  '/purchasing': ['stock.purchase'],
  '/expenses': ['expense.view'],
  '/payments': ['payment.view', 'payment.receive', 'payment.pay', 'cash.manage'],
  '/ledgers': ['customer.view'],
  '/returns': ['sale.return'],
  '/exchanges': ['sale.return'],
  '/reports': REPORT_VIEW_CODES,
  '/reports/sales': ['report.sales'],
  '/reports/stock': ['report.stock'],
  '/reports/profit': ['report.profit'],
  '/reports/dues': ['report.ledger'],
  '/reports/vat': ['report.vat'],
  '/audit': ['settings.manage'],
  '/settings': ['settings.manage', 'user.manage'],
  '/settings/staff': ['user.manage'],
  '/settings/online-store': ['settings.manage'],
};

/** True when the user may open `path` (a route pattern from ROUTE_ACCESS). */
export function canOpen(user: PermissionUser | null | undefined, path: string): boolean {
  const anyOf = ROUTE_ACCESS[path];
  return !anyOf || anyOf.some((codename) => hasPermission(user, codename));
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/billing', labelKey: 'billing', icon: ScanLine },
  { to: '/bills', labelKey: 'bills', icon: ReceiptText },
  { to: '/online-orders', labelKey: 'onlineOrders', icon: ShoppingBag, feature: 'ecommerce' },
  { to: '/catalog', labelKey: 'catalog', icon: Package },
  { to: '/pricing', labelKey: 'pricing', icon: Tag },
  { to: '/customers', labelKey: 'customers', icon: Users },
  { to: '/stock', labelKey: 'stock', icon: Boxes, end: true },
  {
    to: '/stock/transfers',
    labelKey: 'transfers',
    icon: ArrowLeftRight,
    feature: 'multi_branch',
  },
  { to: '/purchasing', labelKey: 'purchasing', icon: Truck },
  { to: '/expenses', labelKey: 'expenses', icon: Wallet },
  { to: '/payments', labelKey: 'payments', icon: Banknote },
  { to: '/ledgers', labelKey: 'ledgers', icon: BookOpen },
  { to: '/returns', labelKey: 'returns', icon: Undo2 },
  { to: '/exchanges', labelKey: 'exchanges', icon: Repeat },
  { to: '/reports', labelKey: 'reports', icon: BarChart3 },
  { to: '/audit', labelKey: 'audit', icon: ScrollText },
  { to: '/settings/security', labelKey: 'security', icon: ShieldCheck },
  { to: '/settings', labelKey: 'settings', icon: Settings },
];

export const NAV_SECTION_ORDER = ['sales', 'catalog', 'manage'] as const;
type NavSectionKey = (typeof NAV_SECTION_ORDER)[number];

export const NAV_SECTION_BY_PATH: Record<string, NavSectionKey> = {
  '/billing': 'sales',
  '/billing/simple': 'sales',
  '/bills': 'sales',
  '/online-orders': 'sales',
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
  '/settings/security': 'manage',
  '/settings/staff': 'manage',
};

export const MOBILE_TABS_BEFORE_FAB = ['/', '/stock'] as const;
export const MOBILE_TABS_AFTER_FAB = ['/reports'] as const;

export function useVisibleNavItems(): NavItem[] {
  const { user } = useAuth();
  return NAV_ITEMS.filter(
    (item) => canOpen(user, item.to) && (!item.feature || hasPlanFeature(user, item.feature)),
  ).map((item) => {
    if (item.to === '/settings' && !hasPermission(user, 'settings.manage')) {
      return { ...item, to: '/settings/staff' };
    }
    if (item.to === '/billing') {
      return { ...item, to: billingPath(user) };
    }
    return item;
  });
}
