import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';

import { AppLayout } from '@/app/AppLayout';
import { AuditPage } from '@/features/audit/AuditPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { BillingPage } from '@/features/billing/BillingPage';
import { ItemDetailPage } from '@/features/catalog/ItemDetailPage';
import { ItemFormPage } from '@/features/catalog/ItemFormPage';
import { ItemsPage } from '@/features/catalog/ItemsPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { ExchangePage } from '@/features/exchange/ExchangePage';
import { StockPage } from '@/features/inventory/StockPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { PartyLedgerPage } from '@/features/payments/PartyLedgerPage';
import { PurchasingPage } from '@/features/purchasing/PurchasingPage';
import { ReturnsPage } from '@/features/returns/ReturnsPage';
import { DuesReportPage } from '@/features/reports/DuesReportPage';
import { ProfitReportPage } from '@/features/reports/ProfitReportPage';
import { ReportsHomePage } from '@/features/reports/ReportsHomePage';
import { SalesReportPage } from '@/features/reports/SalesReportPage';
import { StockReportsPage } from '@/features/reports/StockReportsPage';
import { VatRegisterPage } from '@/features/reports/VatRegisterPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { StaffPage } from '@/features/settings/StaffPage';
import { SupportAccessPage } from '@/features/support/SupportAccessPage';
import { SupportLoginPage } from '@/features/support/SupportLoginPage';

/**
 * Route skeleton. Feature routes mount here as modules land; super-admin
 * routes will live under /admin and only mount on the `admin.` host
 * (docs/SYSTEM_DESIGN.md §8.3). Everything except /login sits behind
 * RequireAuth — the API rejects unauthenticated calls anyway, the guard
 * just saves the round-trip.
 */
function DashboardPlaceholder() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="mt-2 text-slate-600">
        Scaffold only — the real dashboard (docs/SYSTEM_DESIGN.md §7.2) lands with the reports
        feature.
      </p>
    </main>
  );
}

function NotFound() {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-slate-600">This page does not exist.</p>
      <Link className="mt-4 inline-block text-blue-600 underline" to="/">
        Back to dashboard
      </Link>
    </main>
  );
}

let router: ReturnType<typeof createBrowserRouter> | null = null;

function getRouter() {
  router ??= createBrowserRouter([
    { path: '/login', element: <LoginPage /> },
    { path: '/support-login', element: <SupportLoginPage /> },
    {
      element: (
        <RequireAuth>
          <AppLayout />
        </RequireAuth>
      ),
      children: [
        { path: '/', element: <DashboardPlaceholder /> },
        { path: '/billing', element: <BillingPage /> },
        { path: '/catalog', element: <ItemsPage /> },
        { path: '/catalog/items/new', element: <ItemFormPage /> },
        { path: '/catalog/items/:id', element: <ItemDetailPage /> },
        { path: '/catalog/items/:id/edit', element: <ItemFormPage /> },
        { path: '/stock', element: <StockPage /> },
        { path: '/purchasing', element: <PurchasingPage /> },
        { path: '/expenses', element: <ExpensesPage /> },
        { path: '/payments', element: <PaymentsPage /> },
        { path: '/ledgers', element: <PartyLedgerPage /> },
        { path: '/returns', element: <ReturnsPage /> },
        { path: '/audit', element: <AuditPage /> },
        { path: '/settings', element: <SettingsPage /> },
        { path: '/settings/staff', element: <StaffPage /> },
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
