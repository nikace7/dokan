import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  createCategory,
  createExpense,
  fetchExpenseSummary,
  listCategories,
  listExpenses,
} from '@/features/expenses/api';
import type { Expense, ExpensePayload, ExpenseSummaryGroup } from '@/features/expenses/api';
import { currentBsMonthRange } from '@/features/reports/api';
import { ApiError } from '@/lib/api/client';
import { formatNpr } from '@/lib/money';

type ExpenseFormState = ExpensePayload;

function todayAdKathmandu(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kathmandu' });
}

function emptyForm(): ExpenseFormState {
  return { category: '', amount: '', business_date_ad: todayAdKathmandu(), payee: '', note: '' };
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError || error instanceof Error ? error.message : fallback;
}

const selectClasses =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring';

/** Expense rows: card list below `md`, full table from `md` up. */
function ExpenseList({ expenses }: { expenses: Expense[] }) {
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
              <TableHead>BS date</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Payee</TableHead>
              <TableHead>Note</TableHead>
              <TableHead className="text-right">Amount</TableHead>
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

/** Summary groups: card list below `md`, full table from `md` up. */
function SummaryGroups({ groups }: { groups: ExpenseSummaryGroup[] }) {
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
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Entries</TableHead>
              <TableHead className="text-right">Total</TableHead>
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

/** Owner-facing expense entry and BS-period summary. */
export function ExpensesPage() {
  const queryClient = useQueryClient();
  const initialRange = currentBsMonthRange();
  const [dateFromBs, setDateFromBs] = useState(initialRange.dateFromBs);
  const [dateToBs, setDateToBs] = useState(initialRange.dateToBs);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [page, setPage] = useState(1);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ExpenseFormState>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [categoryName, setCategoryName] = useState('');
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [showCategoryForm, setShowCategoryForm] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ['expenses', 'categories'],
    queryFn: listCategories,
    staleTime: 5 * 60_000,
  });
  const filters = { category: categoryFilter || undefined, dateFromBs, dateToBs, page };
  const expensesQuery = useQuery({
    queryKey: ['expenses', 'list', filters],
    queryFn: () => listExpenses(filters),
  });
  const summaryQuery = useQuery({
    queryKey: ['expenses', 'summary', dateFromBs, dateToBs],
    queryFn: () => fetchExpenseSummary(dateFromBs, dateToBs),
  });

  const createMutation = useMutation({
    mutationFn: createExpense,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'summary'] });
      setForm(emptyForm());
      setShowForm(false);
      setFormError(null);
      setStatusMessage('Expense saved.');
    },
    onError: (error) => setFormError(errorMessage(error, 'Could not save the expense.')),
  });

  const categoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] });
      setForm((current) => ({ ...current, category: category.id }));
      setCategoryName('');
      setCategoryError(null);
      setShowCategoryForm(false);
      setStatusMessage('Category added.');
    },
    onError: (error) => setCategoryError(errorMessage(error, 'Could not add the category.')),
  });

  const expenses = expensesQuery.data?.data ?? [];
  const meta = expensesQuery.data?.meta ?? null;
  const categories = categoriesQuery.data?.data ?? [];

  function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.category || !form.amount || !form.business_date_ad) {
      setFormError('Category, amount, and business date are required.');
      return;
    }
    createMutation.mutate({
      ...form,
      amount: form.amount.trim(),
      payee: form.payee?.trim(),
      note: form.note?.trim(),
    });
  }

  function resetToCurrentMonth() {
    const range = currentBsMonthRange();
    setDateFromBs(range.dateFromBs);
    setDateToBs(range.dateToBs);
    setPage(1);
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}

      <Card
        title="Expenses / खर्च"
        actions={
          <Button
            size="sm"
            onClick={() => {
              setShowForm((current) => !current);
              setStatusMessage(null);
              setFormError(null);
            }}
          >
            {showForm ? 'Close form' : 'Add expense'}
          </Button>
        }
      >
        {showForm ? (
          <form onSubmit={submitExpense} className="mb-4 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-category">Category</Label>
                <select
                  id="expense-category"
                  aria-label="Category"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  className={selectClasses}
                >
                  <option value="">Select a category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label="Amount (NPR)"
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
              <Input
                label="Business date (AD)"
                type="date"
                value={form.business_date_ad}
                onChange={(event) => setForm({ ...form, business_date_ad: event.target.value })}
              />
              <Input
                label="Payee"
                value={form.payee}
                onChange={(event) => setForm({ ...form, payee: event.target.value })}
              />
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="expense-note">Note</Label>
              <textarea
                id="expense-note"
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                rows={2}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            {formError ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            <div className="mt-3 flex gap-2">
              <Button type="submit" disabled={createMutation.isPending || categories.length === 0}>
                {createMutation.isPending ? 'Saving…' : 'Save expense'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-filter-category">Filter category</Label>
            <select
              id="expense-filter-category"
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
              className={selectClasses}
            >
              <option value="">All categories</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="From BS"
            value={dateFromBs}
            onChange={(event) => {
              setDateFromBs(event.target.value);
              setPage(1);
            }}
          />
          <Input
            label="To BS"
            value={dateToBs}
            onChange={(event) => {
              setDateToBs(event.target.value);
              setPage(1);
            }}
          />
          <Button variant="secondary" size="sm" onClick={resetToCurrentMonth}>
            Current month
          </Button>
        </div>

        {categories.length === 0 && !categoriesQuery.isFetching ? (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            Add an expense category before recording an expense.
          </div>
        ) : null}
        {expensesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">Loading…</p>
        ) : null}
        {expensesQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(expensesQuery.error, 'Failed to load expenses.')}
          </p>
        ) : null}
        {expensesQuery.data && expenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No expenses in this period.
          </p>
        ) : null}
        {expenses.length > 0 ? <ExpenseList expenses={expenses} /> : null}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {meta.page} of {meta.total_pages} ({meta.count} expenses)
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card
        title="Expense summary / खर्च सारांश"
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowCategoryForm((current) => !current)}
          >
            {showCategoryForm ? 'Close category form' : 'Add category'}
          </Button>
        }
      >
        {showCategoryForm ? (
          <form
            className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (categoryName.trim()) categoryMutation.mutate(categoryName.trim());
            }}
          >
            <Input
              label="Category name"
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={categoryMutation.isPending || !categoryName.trim()}
            >
              {categoryMutation.isPending ? 'Adding…' : 'Add category'}
            </Button>
            {categoryError ? (
              <p role="alert" className="basis-full text-sm text-destructive">
                {categoryError}
              </p>
            ) : null}
          </form>
        ) : null}
        {summaryQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">Loading summary…</p>
        ) : null}
        {summaryQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(summaryQuery.error, 'Failed to load the expense summary.')}
          </p>
        ) : null}
        {summaryQuery.data ? (
          <>
            <p className="mb-3 text-lg font-semibold">
              Total: {formatNpr(summaryQuery.data.total)}
            </p>
            {summaryQuery.data.groups.length > 0 ? (
              <SummaryGroups groups={summaryQuery.data.groups} />
            ) : (
              <p className="text-sm text-muted-foreground">No grouped expenses in this period.</p>
            )}
          </>
        ) : null}
      </Card>
    </main>
  );
}
