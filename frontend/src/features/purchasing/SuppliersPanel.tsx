import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { createSupplier, listSuppliers } from '@/features/purchasing/api';
import { ApiError } from '@/lib/api/client';

/** Supplier list + quick create form (name is the only required field). */
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
          className="mb-4 grid gap-2 rounded-md border border-border bg-muted/50 p-3 sm:grid-cols-4"
        >
          <Input
            aria-label="Supplier name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name *"
            required
          />
          <Input
            aria-label="Supplier phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone"
          />
          <Input
            aria-label="Supplier PAN"
            value={panNo}
            onChange={(e) => setPanNo(e.target.value)}
            placeholder="PAN no."
          />
          <div className="flex items-start gap-2">
            <Input
              aria-label="Supplier address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
            />
            <Button type="submit" size="sm" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? 'Saving…' : 'Add'}
            </Button>
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive sm:col-span-4">
              {error}
            </p>
          ) : null}
        </form>
      ) : null}

      {suppliersQuery.isFetching ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : null}
      {suppliersQuery.data && suppliers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">No suppliers yet.</p>
      ) : null}
      {suppliers.length > 0 ? (
        <>
          <ul className="divide-y divide-border md:hidden">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="py-3 text-sm">
                <p className="font-medium">{supplier.name}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">Phone</dt>
                    <dd>{supplier.phone ?? '—'}</dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">PAN</dt>
                    <dd>{supplier.pan_no ?? '—'}</dd>
                  </div>
                  <div className="col-span-2 flex gap-1">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd>{supplier.address ?? '—'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>Address</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.phone ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.pan_no ?? '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.address ?? '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
    </Card>
  );
}
