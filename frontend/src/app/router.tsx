import { lazy } from 'react';
import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';

import { AppShell } from '@/components/layout/AppShell';
import { RequireAuth } from '@/features/auth/RequireAuth';

const AuditPage = lazy(() =>
  import('@/features/audit/AuditPage').then(({ AuditPage: Component }) => ({ default: Component })),
);
const LoginPage = lazy(() =>
  import('@/features/auth/LoginPage').then(({ LoginPage: Component }) => ({ default: Component })),
);
const PasswordResetPage = lazy(() =>
  import('@/features/auth/PasswordResetPage').then(({ PasswordResetPage: Component }) => ({
    default: Component,
  })),
);
const BillingPage = lazy(() =>
  import('@/features/billing/BillingPage').then(({ BillingPage: Component }) => ({
    default: Component,
  })),
);
const SharedBillPage = lazy(() =>
  import('@/features/billing/SharedBillPage').then(({ SharedBillPage: Component }) => ({
    default: Component,
  })),
);
const SimpleSalePage = lazy(() =>
  import('@/features/billing/SimpleSalePage').then(({ SimpleSalePage: Component }) => ({
    default: Component,
  })),
);
const ItemDetailPage = lazy(() =>
  import('@/features/catalog/ItemDetailPage').then(({ ItemDetailPage: Component }) => ({
    default: Component,
  })),
);
const ItemFormPage = lazy(() =>
  import('@/features/catalog/ItemFormPage').then(({ ItemFormPage: Component }) => ({
    default: Component,
  })),
);
const ItemsPage = lazy(() =>
  import('@/features/catalog/ItemsPage').then(({ ItemsPage: Component }) => ({
    default: Component,
  })),
);
const QuickAddProductPage = lazy(() =>
  import('@/features/catalog/QuickAddProductPage').then(({ QuickAddProductPage: Component }) => ({
    default: Component,
  })),
);
const DashboardPage = lazy(() =>
  import('@/features/dashboard/DashboardPage').then(({ DashboardPage: Component }) => ({
    default: Component,
  })),
);
const CustomersPage = lazy(() =>
  import('@/features/customers/CustomersPage').then(({ CustomersPage: Component }) => ({
    default: Component,
  })),
);
const ExpensesPage = lazy(() =>
  import('@/features/expenses/ExpensesPage').then(({ ExpensesPage: Component }) => ({
    default: Component,
  })),
);
const ExchangePage = lazy(() =>
  import('@/features/exchange/ExchangePage').then(({ ExchangePage: Component }) => ({
    default: Component,
  })),
);
const StockPage = lazy(() =>
  import('@/features/inventory/StockPage').then(({ StockPage: Component }) => ({
    default: Component,
  })),
);
const TransfersPage = lazy(() =>
  import('@/features/inventory/TransfersPage').then(({ TransfersPage: Component }) => ({
    default: Component,
  })),
);
const CountsPage = lazy(() =>
  import('@/features/inventory/CountsPage').then(({ CountsPage: Component }) => ({
    default: Component,
  })),
);
const PaymentsPage = lazy(() =>
  import('@/features/payments/PaymentsPage').then(({ PaymentsPage: Component }) => ({
    default: Component,
  })),
);
const PartyLedgerPage = lazy(() =>
  import('@/features/payments/PartyLedgerPage').then(({ PartyLedgerPage: Component }) => ({
    default: Component,
  })),
);
const PurchasingPage = lazy(() =>
  import('@/features/purchasing/PurchasingPage').then(({ PurchasingPage: Component }) => ({
    default: Component,
  })),
);
const PricingPage = lazy(() =>
  import('@/features/pricing/PricingPage').then(({ PricingPage: Component }) => ({
    default: Component,
  })),
);
const ReturnsPage = lazy(() =>
  import('@/features/returns/ReturnsPage').then(({ ReturnsPage: Component }) => ({
    default: Component,
  })),
);
const DuesReportPage = lazy(() =>
  import('@/features/reports/DuesReportPage').then(({ DuesReportPage: Component }) => ({
    default: Component,
  })),
);
const ProfitReportPage = lazy(() =>
  import('@/features/reports/ProfitReportPage').then(({ ProfitReportPage: Component }) => ({
    default: Component,
  })),
);
const ReportsHomePage = lazy(() =>
  import('@/features/reports/ReportsHomePage').then(({ ReportsHomePage: Component }) => ({
    default: Component,
  })),
);
const SalesReportPage = lazy(() =>
  import('@/features/reports/SalesReportPage').then(({ SalesReportPage: Component }) => ({
    default: Component,
  })),
);
const StockReportsPage = lazy(() =>
  import('@/features/reports/StockReportsPage').then(({ StockReportsPage: Component }) => ({
    default: Component,
  })),
);
const VatRegisterPage = lazy(() =>
  import('@/features/reports/VatRegisterPage').then(({ VatRegisterPage: Component }) => ({
    default: Component,
  })),
);
const SettingsPage = lazy(() =>
  import('@/features/settings/SettingsPage').then(({ SettingsPage: Component }) => ({
    default: Component,
  })),
);
const SecurityPage = lazy(() =>
  import('@/features/settings/SecurityPage').then(({ SecurityPage: Component }) => ({
    default: Component,
  })),
);
const OnlineStorePage = lazy(() =>
  import('@/features/settings/OnlineStorePage').then(({ OnlineStorePage: Component }) => ({
    default: Component,
  })),
);
const OnlineOrdersPage = lazy(() =>
  import('@/features/storefrontOrders/OnlineOrdersPage').then(
    ({ OnlineOrdersPage: Component }) => ({ default: Component }),
  ),
);
const StaffPage = lazy(() =>
  import('@/features/settings/StaffPage').then(({ StaffPage: Component }) => ({
    default: Component,
  })),
);
const SupportAccessPage = lazy(() =>
  import('@/features/support/SupportAccessPage').then(({ SupportAccessPage: Component }) => ({
    default: Component,
  })),
);
const SupportLoginPage = lazy(() =>
  import('@/features/support/SupportLoginPage').then(({ SupportLoginPage: Component }) => ({
    default: Component,
  })),
);

/**
 * Route skeleton. Feature routes mount here as modules land; super-admin
 * routes will live under /admin and only mount on the `admin.` host
 * (docs/SYSTEM_DESIGN.md §8.3). Everything except /login sits behind
 * RequireAuth — the API rejects unauthenticated calls anyway, the guard
 * just saves the round-trip.
 */
function NotFound() {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-muted-foreground">This page does not exist.</p>
      <Link className="mt-4 inline-block text-primary underline" to="/">
        Back to dashboard
      </Link>
    </main>
  );
}

let router: ReturnType<typeof createBrowserRouter> | null = null;

function getRouter() {
  router ??= createBrowserRouter([
    { path: '/login', element: <LoginPage /> },
    { path: '/forgot-password', element: <PasswordResetPage /> },
    { path: '/support-login', element: <SupportLoginPage /> },
    // Public online bill: the share token is the capability, so this route
    // deliberately sits OUTSIDE RequireAuth (no login redirect for customers).
    { path: '/bill/:token', element: <SharedBillPage /> },
    {
      element: (
        <RequireAuth>
          <AppShell />
        </RequireAuth>
      ),
      children: [
        { path: '/', element: <DashboardPage /> },
        { path: '/billing', element: <BillingPage /> },
        { path: '/billing/simple', element: <SimpleSalePage /> },
        { path: '/online-orders', element: <OnlineOrdersPage /> },
        { path: '/catalog', element: <ItemsPage /> },
        { path: '/catalog/items/new', element: <QuickAddProductPage /> },
        { path: '/catalog/items/:id', element: <ItemDetailPage /> },
        { path: '/catalog/items/:id/edit', element: <ItemFormPage /> },
        { path: '/pricing', element: <PricingPage /> },
        { path: '/customers', element: <CustomersPage /> },
        { path: '/stock', element: <StockPage /> },
        { path: '/stock/transfers', element: <TransfersPage /> },
        { path: '/stock/counts', element: <CountsPage /> },
        { path: '/purchasing', element: <PurchasingPage /> },
        { path: '/expenses', element: <ExpensesPage /> },
        { path: '/payments', element: <PaymentsPage /> },
        { path: '/ledgers', element: <PartyLedgerPage /> },
        { path: '/returns', element: <ReturnsPage /> },
        { path: '/audit', element: <AuditPage /> },
        { path: '/settings', element: <SettingsPage /> },
        { path: '/settings/security', element: <SecurityPage /> },
        { path: '/settings/staff', element: <StaffPage /> },
        { path: '/settings/online-store', element: <OnlineStorePage /> },
        { path: '/settings/support-access', element: <SupportAccessPage /> },
        { path: '/exchanges', element: <ExchangePage /> },
        { path: '/reports', element: <ReportsHomePage /> },
        { path: '/reports/sales', element: <SalesReportPage /> },
        { path: '/reports/stock', element: <StockReportsPage /> },
        { path: '/reports/profit', element: <ProfitReportPage /> },
        { path: '/reports/dues', element: <DuesReportPage /> },
        { path: '/reports/vat', element: <VatRegisterPage /> },
      ],
    },
    { path: '*', element: <NotFound /> },
  ]);
  return router;
}

export function AppRouter() {
  return <RouterProvider router={getRouter()} />;
}
