import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { createSupplier, listSuppliers } from '@/features/purchasing/api';
import { ApiError } from '@/lib/api/client';

/** Supplier table + quick create form (name is the only required field). */
export function SuppliersPanel() {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [panNo, setPanNo] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const suppliersQuery = useQuery({
    queryKey: ['purchasing', 'suppliers'],
    queryFn: () => listSuppliers(),
  });

  const createMutation = useMutation({
    mutationFn: createSupplier,
    onSuccess: () => {
      setShowForm(false);
      setName('');
      setPhone('');
      setPanNo('');
      setAddress('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ['purchasing', 'suppliers'] });
    },
    onError: (err) =>
      setError(err instanceof ApiError ? err.message : 'Could not create the supplier.'),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    createMutation.mutate({
      name: name.trim(),
      phone: phone.trim() || null,
      pan_no: panNo.trim() || null,
      address: address.trim() || null,
    });
  };

  const suppliers = (suppliersQuery.data?.data ?? []).filter((s) => s.is_active);

  return (
    <Card
      title="Suppliers / सप्लायर"
      actions={
        <Button variant="secondary" size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Close' : 'New supplier'}
        </Button>
      }
    >
      {showForm ? (
        <form
          onSubmit={onSubmit}
          className="mb-4 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-4"
        >
          <input
            aria-label="Supplier name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name *"
            required
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            aria-label="Supplier phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <input
            aria-label="Supplier PAN"
            value={panNo}
            onChange={(e) => setPanNo(e.target.value)}
            placeholder="PAN no."
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <input
              aria-label="Supplier address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <Button type="submit" size="sm" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? 'Saving…' : 'Add'}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-red-600 sm:col-span-4">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {suppliersQuery.isFetching ? <p className="text-sm text-slate-500">Loading…</p> : null}
      {suppliersQuery.data && suppliers.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-500">No suppliers yet.</p>
      ) : null}
      {suppliers.length > 0 ? (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
              <th className="py-2 pr-2 font-medium">Name</th>
              <th className="py-2 pr-2 font-medium">Phone</th>
              <th className="py-2 pr-2 font-medium">PAN</th>
              <th className="py-2 font-medium">Address</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id} className="border-b border-slate-100">
                <td className="py-2 pr-2 font-medium">{supplier.name}</td>
                <td className="py-2 pr-2 text-slate-600">{supplier.phone ?? '—'}</td>
                <td className="py-2 pr-2 text-slate-600">{supplier.pan_no ?? '—'}</td>
                <td className="py-2 text-slate-600">{supplier.address ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Card>
  );
}
