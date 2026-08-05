import { createBrowserRouter, Link, Navigate, RouterProvider } from 'react-router-dom';

import { AdminLayout } from '@/features/admin/AdminLayout';
import { PlansPage } from '@/features/admin/PlansPage';
import { PlatformAuditPage } from '@/features/admin/PlatformAuditPage';
import { PlatformLoginPage } from '@/features/admin/PlatformLoginPage';
import { RequirePlatformAuth } from '@/features/admin/RequirePlatformAuth';
import { TenantDetailPage } from '@/features/admin/TenantDetailPage';
import { TenantsPage } from '@/features/admin/TenantsPage';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

function PlatformAuditRoute() {
  const { user } = usePlatformAuth();
  return user?.role === 'SUPER_ADMIN' ? (
    <PlatformAuditPage />
  ) : (
    <Navigate to="/admin/tenants" replace />
  );
}

function AdminNotFound() {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">404</h1>
      <p className="mt-2 text-slate-600">This control-plane page does not exist.</p>
      <Link className="mt-4 inline-block text-blue-700 underline" to="/admin/tenants">
        Back to tenants
      </Link>
    </main>
  );
}

let router: ReturnType<typeof createBrowserRouter> | null = null;

function getRouter() {
  router ??= createBrowserRouter([
    { path: '/admin/login', element: <PlatformLoginPage /> },
    {
      element: (
        <RequirePlatformAuth>
          <AdminLayout />
        </RequirePlatformAuth>
      ),
      children: [
        { path: '/admin', element: <Navigate to="/admin/tenants" replace /> },
        { path: '/admin/tenants', element: <TenantsPage /> },
        { path: '/admin/tenants/:id', element: <TenantDetailPage /> },
        { path: '/admin/plans', element: <PlansPage /> },
        { path: '/admin/audit', element: <PlatformAuditRoute /> },
      ],
    },
    { path: '*', element: <AdminNotFound /> },
  ]);
  return router;
}

export function AdminRouter() {
  return <RouterProvider router={getRouter()} />;
}
