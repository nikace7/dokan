import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { listPlatformAudit } from '@/features/admin/api';

export function PlatformAuditPage() {
  const [action, setAction] = useState('');
  const [tenant, setTenant] = useState('');
  const [platformUser, setPlatformUser] = useState('');
  const [page, setPage] = useState(1);
  const audit = useQuery({
    queryKey: ['platform', 'audit', action, tenant, platformUser, page],
    queryFn: () =>
      listPlatformAudit({
        action: action.trim(),
        tenant: tenant.trim(),
        platform_user: platformUser.trim(),
        page,
      }),
  });

  return (
    <main className="mx-auto max-w-6xl p-4">
      <Card title="Platform audit">
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <input
            aria-label="Audit action"
            placeholder="tenant.suspend"
            value={action}
            onChange={(event) => {
              setAction(event.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            aria-label="Tenant UUID"
            placeholder="Tenant UUID"
            value={tenant}
            onChange={(event) => {
              setTenant(event.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            aria-label="Platform user UUID"
            placeholder="Platform user UUID"
            value={platformUser}
            onChange={(event) => {
              setPlatformUser(event.target.value);
              setPage(1);
            }}
            className="rounded border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        {audit.isPending ? <p className="py-4 text-sm text-slate-500">Loading audit…</p> : null}
        {audit.isError ? (
          <p role="alert" className="py-4 text-sm text-red-700">
            {audit.error instanceof Error ? audit.error.message : 'Could not load audit.'}
          </p>
        ) : null}
        {audit.data?.data.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No matching entries.</p>
        ) : null}
        {audit.data?.data.length ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-slate-500">
                <th className="py-2">Time</th>
                <th className="py-2">Actor</th>
                <th className="py-2">Action</th>
                <th className="py-2">Tenant</th>
                <th className="py-2">Context</th>
              </tr>
            </thead>
            <tbody>
              {audit.data.data.map((row) => (
                <tr key={row.id} className="border-b border-slate-100 align-top">
                  <td className="py-2 whitespace-nowrap">
                    {new Date(row.created_at).toLocaleString()}
                  </td>
                  <td className="py-2">{row.platform_user_name}</td>
                  <td className="py-2 font-mono text-xs">{row.action}</td>
                  <td className="py-2 font-mono text-xs">{row.tenant ?? 'platform'}</td>
                  <td className="py-2">
                    <pre className="max-w-md whitespace-pre-wrap break-all text-xs">
                      {JSON.stringify(row.payload)}
                    </pre>
                    {row.ip ? <span className="text-xs text-slate-500">IP {row.ip}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
        {audit.data?.meta && audit.data.meta.total_pages > 1 ? (
          <div className="mt-4 flex justify-between text-sm">
            <span>
              Page {audit.data.meta.page} of {audit.data.meta.total_pages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= audit.data.meta.total_pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>
    </main>
  );
}
