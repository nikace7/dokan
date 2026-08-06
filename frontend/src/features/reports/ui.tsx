import type { ReactNode } from 'react';

import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/** Inline error banner shared by every report screen. */
export function ReportError({ error }: { error: unknown }) {
  return (
    <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
      {error instanceof Error ? error.message : 'Failed to load the report.'}
    </p>
  );
}

/** Placeholder skeleton matching the report-table shape. */
export function TableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading report">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-8 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

export interface ReportColumn {
  header: ReactNode;
  /** Extra classes for both the head cell and body cells (e.g. text-right). */
  className?: string;
}

interface ReportTableProps<TRow> {
  columns: readonly ReportColumn[];
  rows: readonly TRow[];
  rowKey: (row: TRow) => string;
  /** Desktop row cells — one TableCell per column. */
  renderCells: (row: TRow) => ReactNode;
  /** Mobile card content for one row. */
  renderCard: (row: TRow) => ReactNode;
  /** Desktop totals row(s), rendered inside the table footer. */
  footer?: ReactNode;
  /** Mobile totals card, rendered under the card list. */
  mobileFooter?: ReactNode;
  empty: string;
}

/**
 * The standard report-results pattern: a card list on small screens and a
 * full table from `md` up, with a totals row and an empty state. Both views
 * render the same rows; CSS picks one, so nothing needs JS breakpoint logic.
 */
export function ReportTable<TRow>({
  columns,
  rows,
  rowKey,
  renderCells,
  renderCard,
  footer,
  mobileFooter,
  empty,
}: ReportTableProps<TRow>) {
  if (rows.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }
  return (
    <>
      <div className="md:hidden">
        <ul className="divide-y divide-border">
          {rows.map((row) => (
            <li key={rowKey(row)} className="py-3">
              {renderCard(row)}
            </li>
          ))}
        </ul>
        {mobileFooter}
      </div>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead key={index} className={column.className}>
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={rowKey(row)}>{renderCells(row)}</TableRow>
            ))}
          </TableBody>
          {footer ? <TableFooter>{footer}</TableFooter> : null}
        </Table>
      </div>
    </>
  );
}

/** Money cell helper — right-aligned tabular figures for the desktop table. */
export function MoneyCell({ children }: { children: ReactNode }) {
  return <TableCell className="text-right tabular-nums">{children}</TableCell>;
}
