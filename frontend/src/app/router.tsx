import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';

import { AppLayout } from '@/app/AppLayout';
import { LoginPage } from '@/features/auth/LoginPage';
import { RequireAuth } from '@/features/auth/RequireAuth';
import { BillingPage } from '@/features/billing/BillingPage';
import { ItemDetailPage } from '@/features/catalog/ItemDetailPage';
import { ItemFormPage } from '@/features/catalog/ItemFormPage';
import { ItemsPage } from '@/features/catalog/ItemsPage';
import { StockPage } from '@/features/inventory/StockPage';

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

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
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
    ],
  },
  { path: '*', element: <NotFound /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
