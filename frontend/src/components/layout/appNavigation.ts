import {
  ArrowLeftRight,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  LayoutDashboard,
  Package,
  Repeat,
  ScanLine,
  ScrollText,
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
import type { PermissionCodename } from '@/lib/permissions';
import { billingPath, hasPlanFeature } from '@/lib/plans';
import type { PlanFeature } from '@/lib/plans';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
  anyOf?: PermissionCodename[];
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

const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'dashboard', icon: LayoutDashboard, end: true },
  { to: '/billing', labelKey: 'billing', icon: ScanLine, anyOf: ['sale.create'] },
  { to: '/catalog', labelKey: 'catalog', icon: Package, anyOf: ['catalog.view'] },
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
  { to: '/purchasing', labelKey: 'purchasing', icon: Truck, anyOf: ['stock.purchase'] },
  { to: '/expenses', labelKey: 'expenses', icon: Wallet, anyOf: ['expense.view'] },
  {
    to: '/payments',
    labelKey: 'payments',
    icon: Banknote,
    anyOf: ['payment.view', 'payment.receive', 'cash.manage'],
  },
  { to: '/ledgers', labelKey: 'ledgers', icon: BookOpen, anyOf: ['customer.view'] },
  { to: '/returns', labelKey: 'returns', icon: Undo2, anyOf: ['sale.return'] },
  { to: '/exchanges', labelKey: 'exchanges', icon: Repeat, anyOf: ['sale.return'] },
  { to: '/reports', labelKey: 'reports', icon: BarChart3, anyOf: REPORT_VIEW_CODES },
  { to: '/audit', labelKey: 'audit', icon: ScrollText, anyOf: ['settings.manage'] },
  { to: '/settings/security', labelKey: 'security', icon: ShieldCheck },
  {
    to: '/settings',
    labelKey: 'settings',
    icon: Settings,
    anyOf: ['settings.manage', 'user.manage'],
  },
];

export const NAV_SECTION_ORDER = ['sales', 'catalog', 'manage'] as const;
type NavSectionKey = (typeof NAV_SECTION_ORDER)[number];

export const NAV_SECTION_BY_PATH: Record<string, NavSectionKey> = {
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
  '/settings/security': 'manage',
  '/settings/staff': 'manage',
};

export const MOBILE_TABS_BEFORE_FAB = ['/', '/stock'] as const;
export const MOBILE_TABS_AFTER_FAB = ['/reports'] as const;

export function useVisibleNavItems(): NavItem[] {
  const { user } = useAuth();
  return NAV_ITEMS.filter((item) => {
    if (item.anyOf && !item.anyOf.some((codename) => hasPermission(user, codename))) {
      return false;
    }
    return !item.feature || hasPlanFeature(user, item.feature);
  }).map((item) => {
    if (item.to === '/settings' && !hasPermission(user, 'settings.manage')) {
      return { ...item, to: '/settings/staff' };
    }
    if (item.to === '/billing') {
      return { ...item, to: billingPath(user) };
    }
    return item;
  });
}
