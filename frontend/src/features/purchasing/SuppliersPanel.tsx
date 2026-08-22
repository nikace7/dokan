import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';

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

/** Supplier phone as a tappable tel: link; em dash when there is none. */
function SupplierPhone({ name, phone }: { name: string; phone: string | null }) {
  const { t } = useTranslation();
  if (!phone) return <>—</>;
  return (
    <a
      href={`tel:${phone}`}
      aria-label={t('purchasing.suppliers.callAria', { name, defaultValue: 'Call {{name}}' })}
      className="inline-flex items-center gap-1 text-primary hover:underline"
    >
      <Phone aria-hidden className="h-3.5 w-3.5" />
      {phone}
    </a>
  );
}

/** Supplier list + quick create form (name is the only required field). */
export function SuppliersPanel() {
  const { t } = useTranslation();
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
      setError(err instanceof ApiError ? err.message : t('purchasing.suppliers.createError')),
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
      title={t('purchasing.suppliers.title')}
      actions={
        <Button variant="secondary" size="sm" onClick={() => setShowForm((s) => !s)}>
          {showForm ? t('purchasing.suppliers.close') : t('purchasing.suppliers.new')}
        </Button>
      }
    >
      {showForm ? (
        <form
          onSubmit={onSubmit}
          className="mb-4 grid gap-2 rounded-md border border-border bg-muted/50 p-3 sm:grid-cols-4"
        >
          <Input
            aria-label={t('purchasing.suppliers.nameAria')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('purchasing.suppliers.namePlaceholder')}
            required
          />
          <Input
            aria-label={t('purchasing.suppliers.phoneAria')}
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder={t('purchasing.suppliers.phonePlaceholder')}
          />
          <Input
            aria-label={t('purchasing.suppliers.panAria')}
            value={panNo}
            onChange={(e) => setPanNo(e.target.value)}
            placeholder={t('purchasing.suppliers.panPlaceholder')}
          />
          <div className="flex items-start gap-2">
            <Input
              aria-label={t('purchasing.suppliers.addressAria')}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder={t('purchasing.suppliers.addressPlaceholder')}
            />
            <Button type="submit" size="sm" disabled={createMutation.isPending || !name.trim()}>
              {createMutation.isPending ? t('common.saving') : t('purchasing.suppliers.add')}
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
        <p className="text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : null}
      {suppliersQuery.data && suppliers.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          {t('purchasing.suppliers.empty')}
        </p>
      ) : null}
      {suppliers.length > 0 ? (
        <>
          <ul className="divide-y divide-border md:hidden">
            {suppliers.map((supplier) => (
              <li key={supplier.id} className="py-3 text-sm">
                <p className="font-medium">{supplier.name}</p>
                <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('purchasing.suppliers.phone')}</dt>
                    <dd>
                      <SupplierPhone name={supplier.name} phone={supplier.phone} />
                    </dd>
                  </div>
                  <div className="flex gap-1">
                    <dt className="text-muted-foreground">{t('purchasing.suppliers.pan')}</dt>
                    <dd>{supplier.pan_no ?? '—'}</dd>
                  </div>
                  <div className="col-span-2 flex gap-1">
                    <dt className="shrink-0 text-muted-foreground">
                      {t('purchasing.suppliers.address')}
                    </dt>
                    <dd className="truncate">{supplier.address ?? '—'}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('purchasing.suppliers.name')}</TableHead>
                  <TableHead>{t('purchasing.suppliers.phone')}</TableHead>
                  <TableHead>{t('purchasing.suppliers.pan')}</TableHead>
                  <TableHead>{t('purchasing.suppliers.address')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {suppliers.map((supplier) => (
                  <TableRow key={supplier.id}>
                    <TableCell className="font-medium">{supplier.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      <SupplierPhone name={supplier.name} phone={supplier.phone} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {supplier.pan_no ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-48 truncate text-muted-foreground">
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
