/**
 * Shared primitives for the platform-admin portal (admin host).
 *
 * Slice A owns this file: the feature-page slices (tenants, plans/billing,
 * support) compose these instead of re-inventing headers, cards, badges,
 * and skeletons. Everything is built on the design-system tokens and the
 * `@/components/ui` primitives — no raw palette classes.
 */
import { Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import type { BadgeProps } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { EmptyState as BaseEmptyState } from '@/components/ui/EmptyState';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { TableCell, TableRow } from '@/components/ui/table';
import type { TenantStatus } from '@/features/admin/api';
import { cn } from '@/lib/utils';

/** Page top: title, optional description, right-aligned actions slot. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Titled section card with optional description and a header actions slot. */
export function AdminCard({
  title,
  description,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Extra classes on the content wrapper (e.g. `p-0` for flush tables). */
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      {title || description || actions ? (
        <CardHeader className="flex-row items-start justify-between space-y-0 border-b px-4 py-3">
          <div className="space-y-1">
            {title ? <CardTitle className="text-base">{title}</CardTitle> : null}
            {description ? <CardDescription>{description}</CardDescription> : null}
          </div>
          {actions}
        </CardHeader>
      ) : null}
      <CardContent className={cn('p-4', contentClassName)}>{children}</CardContent>
    </Card>
  );
}

const STATUS_VARIANT: Record<TenantStatus, BadgeProps['variant']> = {
  TRIAL: 'secondary',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  SUSPENDED: 'destructive',
  CANCELLED: 'outline',
};

const STATUS_LABEL: Record<TenantStatus, string> = {
  TRIAL: 'Trial',
  ACTIVE: 'Active',
  PAST_DUE: 'Past due',
  SUSPENDED: 'Suspended',
  CANCELLED: 'Cancelled',
};

/** Tenant lifecycle status pill with semantic colors. */
export function StatusBadge({
  status,
  className,
}: {
  status: TenantStatus;
  className?: string;
}) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

/**
 * Form field wrapper: label, control, and one slot showing either the
 * error (destructive) or the hint (muted). Pass the control's `id` via
 * `htmlFor` so the label wires up for assistive tech and test queries.
 */
export function Field({
  label,
  htmlFor,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

/** Empty surface for lists/tables with no rows; icon defaults to Inbox. */
export function EmptyState({
  icon = Inbox,
  title,
  body,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <BaseEmptyState icon={icon} title={title} body={body} action={action} className={className} />
  );
}

/**
 * Table loading skeleton. Render inside a `<TableBody>` while the query is
 * pending: `<TableBody>{isLoading ? <LoadingRows columns={5} /> : …}</TableBody>`.
 */
export function LoadingRows({
  columns,
  rows = 4,
  className,
}: {
  columns: number;
  rows?: number;
  className?: string;
}) {
  return (
    <>
      {Array.from({ length: rows }, (_item, rowIndex) => (
        <TableRow key={rowIndex} className={className}>
          {Array.from({ length: columns }, (_cell, cellIndex) => (
            <TableCell key={cellIndex}>
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ))}
        </TableRow>
      ))}
    </>
  );
}
