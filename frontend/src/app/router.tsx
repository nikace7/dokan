import { createBrowserRouter, Link, RouterProvider } from 'react-router-dom';

/**
 * Route skeleton. Feature routes mount here as modules land; super-admin
 * routes will live under /admin and only mount on the `admin.` host
 * (docs/SYSTEM_DESIGN.md §8.3). No guards yet — auth lands with the
 * accounts feature.
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

function LoginPlaceholder() {
  return (
    <main className="mx-auto max-w-sm p-6">
      <h1 className="text-2xl font-semibold">Login</h1>
      <p className="mt-2 text-slate-600">
        Phone + password auth (SimpleJWT) is implemented with the accounts feature.
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
  { path: '/', element: <DashboardPlaceholder /> },
  { path: '/login', element: <LoginPlaceholder /> },
  { path: '*', element: <NotFound /> },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
