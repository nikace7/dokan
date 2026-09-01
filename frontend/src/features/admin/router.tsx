import { lazy } from 'react';
import { createBrowserRouter, Link, Navigate, RouterProvider } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { AdminLayout } from '@/features/admin/AdminLayout';
import { RequirePlatformAuth } from '@/features/admin/RequirePlatformAuth';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

const PlansPage = lazy(() =>
  import('@/features/admin/PlansPage').then(({ PlansPage: Component }) => ({ default: Component })),
);
const PlatformAuditPage = lazy(() =>
  import('@/features/admin/PlatformAuditPage').then(({ PlatformAuditPage: Component }) => ({
    default: Component,
  })),
);
const PlatformLoginPage = lazy(() =>
  import('@/features/admin/PlatformLoginPage').then(({ PlatformLoginPage: Component }) => ({
    default: Component,
  })),
);
const TenantDetailPage = lazy(() =>
  import('@/features/admin/TenantDetailPage').then(({ TenantDetailPage: Component }) => ({
    default: Component,
  })),
);
const TenantsPage = lazy(() =>
  import('@/features/admin/TenantsPage').then(({ TenantsPage: Component }) => ({
    default: Component,
  })),
);

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
    <main className="flex min-h-screen items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm text-center shadow-card">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-2xl">404</CardTitle>
          <CardDescription>This control-plane page does not exist.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link to="/admin/tenants">Back to tenants</Link>
          </Button>
        </CardContent>
      </Card>
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
        // Bare host root (admin.example.com/) lands here — send it to the
        // tenant list instead of the 404 card; auth guard bounces to login.
        { path: '/', element: <Navigate to="/admin/tenants" replace /> },
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
