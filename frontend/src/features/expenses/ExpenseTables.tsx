import { useTranslation } from 'react-i18next';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Expense, ExpenseSummaryGroup } from '@/features/expenses/api';
import { formatNpr } from '@/lib/money';

export function ExpenseList({ expenses }: { expenses: Expense[] }) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {expenses.map((expense) => (
          <li key={expense.id} className="py-3 text-sm">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium">{expense.category_name}</span>
              <span className="font-semibold tabular-nums">{formatNpr(expense.amount)}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
              <span>{expense.business_date_bs}</span>
              <span>{expense.payee || '—'}</span>
              <span>{expense.note || '—'}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('expenses.bsDate')}</TableHead>
              <TableHead>{t('expenses.category')}</TableHead>
              <TableHead>{t('expenses.payee')}</TableHead>
              <TableHead>{t('common.note')}</TableHead>
              <TableHead className="text-right">{t('expenses.amount')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {expenses.map((expense) => (
              <TableRow key={expense.id}>
                <TableCell className="whitespace-nowrap">{expense.business_date_bs}</TableCell>
                <TableCell className="font-medium">{expense.category_name}</TableCell>
                <TableCell>{expense.payee || '—'}</TableCell>
                <TableCell className="text-muted-foreground">{expense.note || '—'}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNpr(expense.amount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

export function SummaryGroups({ groups }: { groups: ExpenseSummaryGroup[] }) {
  const { t } = useTranslation();
  return (
    <>
      <ul className="divide-y divide-border md:hidden">
        {groups.map((group) => (
          <li key={group.key} className="flex items-baseline gap-3 py-2 text-sm">
            <span className="flex-1">{group.key}</span>
            <span className="text-muted-foreground tabular-nums">{group.count}</span>
            <span className="font-semibold tabular-nums">{formatNpr(group.total)}</span>
          </li>
        ))}
      </ul>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('expenses.category')}</TableHead>
              <TableHead className="text-right">{t('expenses.summary.entries')}</TableHead>
              <TableHead className="text-right">{t('expenses.summary.total')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => (
              <TableRow key={group.key}>
                <TableCell>{group.key}</TableCell>
                <TableCell className="text-right tabular-nums">{group.count}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatNpr(group.total)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
