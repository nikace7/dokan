import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { TableCell } from '@/components/ui/table';
import { billNumber } from '@/features/billing/api';
import { BillStatusBadge, DocTypeBadge, TenderBadges } from '@/features/bills/BillBadges';
import { listBills } from '@/features/bills/api';
import type { BillDocType, BillFilters, BillStatus, BillSummary } from '@/features/bills/api';
import { currentBsMonthRange } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
import { MoneyCell, ReportError, ReportTable, TableSkeleton } from '@/features/reports/ui';
import type { ReportColumn } from '@/features/reports/ui';
import { formatNpr, useMoneyDisplay } from '@/lib/money';

const STATUSES: BillStatus[] = ['COMPLETED', 'HELD', 'CANCELLED'];
const DOC_TYPES: BillDocType[] = ['SALE', 'RETURN', 'EXCHANGE_OUT'];
/** URL value for "no filter" — an absent param means the default instead. */
const ALL = 'all';

function pick<T extends string>(raw: string | null, allowed: T[], fallback: T | ''): T | '' {
  if (raw === ALL) return '';
  return allowed.includes(raw as T) ? (raw as T) : fallback;
}

/**
 * Filters live in the URL, so opening a bill and coming back keeps the
 * range, filters and page. Defaults: completed sales in this BS month.
 */
function useBillFilters() {
  const [params, setParams] = useSearchParams();
  const month = useMemo(currentBsMonthRange, []);
  const invoiceNo = params.get('no');
  const filters: BillFilters = {
    page: Math.max(1, Number.parseInt(params.get('page') ?? '', 10) || 1),
    status: pick(params.get('status'), STATUSES, 'COMPLETED'),
    docType: pick(params.get('type'), DOC_TYPES, 'SALE'),
    invoiceNo: invoiceNo && /^\d+$/.test(invoiceNo) ? Number(invoiceNo) : null,
    dateFromBs: params.get('from') ?? month.dateFromBs,
    dateToBs: params.get('to') ?? month.dateToBs,
  };
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    if (!('page' in changes)) next.delete('page');
    setParams(next);
  };
  return { filters, update };
}

/** Every bill the shop has made: filter, count, and open one. */
export function BillsPage() {
  const { t } = useTranslation();
  const { filters, update } = useBillFilters();
  const query = useQuery({
    queryKey: ['bills', filters],
    queryFn: () => listBills(filters),
    placeholderData: keepPreviousData,
  });
  const meta = query.data?.meta;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 sm:p-6">
      <PageHeader title={t('bills.title')} description={t('bills.description')} />
      <Card>
        <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <BsRangeControls
            value={{ dateFromBs: filters.dateFromBs, dateToBs: filters.dateToBs }}
            onApply={(range) => update({ from: range.dateFromBs, to: range.dateToBs, no: null })}
          />
          <div className="flex flex-wrap items-end gap-2">
            <FilterSelect
              label={t('bills.filters.status')}
              value={filters.status || ALL}
              onChange={(value) => update({ status: value })}
              options={[
                [ALL, t('bills.filters.allStatuses')],
                ...STATUSES.map((s) => [s, t(`bills.status.${s}`)] as [string, string]),
              ]}
            />
            <FilterSelect
              label={t('bills.filters.type')}
              value={filters.docType || ALL}
              onChange={(value) => update({ type: value })}
              options={[
                [ALL, t('bills.filters.allTypes')],
                ...DOC_TYPES.map((d) => [d, t(`bills.docType.${d}`)] as [string, string]),
              ]}
            />
            <BillNumberSearch
              current={filters.invoiceNo}
              onSearch={(no) => update({ no: no === null ? null : String(no) })}
            />
          </div>
        </div>

        {filters.invoiceNo !== null ? (
          <p className="mb-3 text-sm text-muted-foreground">
            {t('bills.searchingNumber', { number: filters.invoiceNo })}
          </p>
        ) : null}
        {meta ? (
          <p className="mb-3 text-sm font-medium" aria-live="polite">
            {t('bills.count', { count: meta.count })}
          </p>
        ) : null}

        {query.isPending ? <TableSkeleton /> : null}
        {query.isError ? <ReportError error={query.error} /> : null}
        {query.data ? <BillsTable rows={query.data.data} /> : null}

        {meta && meta.total_pages > 1 ? (
          <nav
            aria-label={t('bills.pagination')}
            className="mt-4 flex items-center justify-between gap-2 text-sm"
          >
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => update({ page: String(meta.page - 1) })}
            >
              {t('bills.previous')}
            </Button>
            <span className="text-muted-foreground">
              {t('bills.pageOf', { page: meta.page, total: meta.total_pages })}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.total_pages}
              onClick={() => update({ page: String(meta.page + 1) })}
            >
              {t('bills.next')}
            </Button>
          </nav>
        ) : null}
      </Card>
    </main>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-sm font-medium">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-input bg-background px-3 text-sm font-normal"
      >
        {options.map(([optionValue, optionLabel]) => (
          <option key={optionValue} value={optionValue}>
            {optionLabel}
          </option>
        ))}
      </select>
    </label>
  );
}

function BillNumberSearch({
  current,
  onSearch,
}: {
  current: number | null;
  onSearch: (no: number | null) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(current === null ? '' : String(current));
  const [error, setError] = useState<string | undefined>();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const raw = text.trim();
    if (!/^\d+$/.test(raw)) {
      setError(t('bills.search.invalid'));
      return;
    }
    setError(undefined);
    onSearch(Number(raw));
  };

  return (
    <form onSubmit={submit} className="flex items-end gap-2" role="search">
      <div className="w-32">
        <Input
          label={t('bills.search.label')}
          inputMode="numeric"
          placeholder={t('bills.search.placeholder')}
          value={text}
          onChange={(event) => setText(event.target.value)}
          error={error}
        />
      </div>
      <Button type="submit" size="md">
        {t('bills.search.button')}
      </Button>
      {current !== null ? (
        <Button
          type="button"
          variant="ghost"
          size="md"
          onClick={() => {
            setText('');
            setError(undefined);
            onSearch(null);
          }}
        >
          {t('bills.search.clear')}
        </Button>
      ) : null}
    </form>
  );
}

function BillsTable({ rows }: { rows: BillSummary[] }) {
  const { t } = useTranslation();
  useMoneyDisplay();
  const columns: ReportColumn[] = [
    { header: t('bills.columns.number') },
    { header: t('bills.columns.date') },
    { header: t('bills.columns.customer') },
    { header: t('bills.columns.payment') },
    { header: t('bills.columns.status') },
    { header: t('bills.columns.total'), className: 'text-right' },
  ];
  const label = (bill: BillSummary) => billNumber(bill) ?? t(`bills.noNumber.${bill.status}`);

  return (
    <ReportTable
      columns={columns}
      rows={rows}
      rowKey={(bill) => bill.id}
      empty={t('bills.empty')}
      renderCells={(bill) => (
        <>
          <TableCell className="font-mono font-medium">
            <Link to={`/bills/${bill.id}`} className="text-primary hover:underline">
              {label(bill)}
            </Link>{' '}
            <DocTypeBadge docType={bill.doc_type} />
          </TableCell>
          <TableCell>{bill.business_date_bs}</TableCell>
          <TableCell>{bill.customer_name ?? t('billing.walkIn')}</TableCell>
          <TableCell>
            <TenderBadges bill={bill} />
          </TableCell>
          <TableCell>
            <BillStatusBadge status={bill.status} />
          </TableCell>
          <MoneyCell>{formatNpr(bill.total, { symbol: '' })}</MoneyCell>
        </>
      )}
      renderCard={(bill) => (
        <Link to={`/bills/${bill.id}`} className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono font-medium text-primary">
              {label(bill)} <DocTypeBadge docType={bill.doc_type} />
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {bill.business_date_bs} · {bill.customer_name ?? t('billing.walkIn')}
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              <BillStatusBadge status={bill.status} />
              <TenderBadges bill={bill} />
            </div>
          </div>
          <p className="shrink-0 font-semibold tabular-nums">{formatNpr(bill.total)}</p>
        </Link>
      )}
    />
  );
}
