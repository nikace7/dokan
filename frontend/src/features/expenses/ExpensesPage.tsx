import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  createCategory,
  createExpense,
  fetchExpenseSummary,
  listCategories,
  listExpenses,
} from '@/features/expenses/api';
import type { ExpensePayload } from '@/features/expenses/api';
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
        <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">
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
          <form onSubmit={submitExpense} className="mb-4 rounded-md border border-slate-200 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <label htmlFor="expense-category" className="text-sm font-medium text-slate-700">
                  Category
                </label>
                <select
                  id="expense-category"
                  aria-label="Category"
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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
            <label
              htmlFor="expense-note"
              className="mt-3 flex flex-col gap-1 text-sm font-medium text-slate-700"
            >
              Note
              <textarea
                id="expense-note"
                value={form.note}
                onChange={(event) => setForm({ ...form, note: event.target.value })}
                rows={2}
                className="rounded-md border border-slate-300 px-3 py-2 font-normal focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            {formError ? (
              <p role="alert" className="mt-2 text-sm text-red-600">
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
          <div className="flex flex-col gap-1">
            <label htmlFor="expense-filter-category" className="text-sm font-medium text-slate-700">
              Filter category
            </label>
            <select
              id="expense-filter-category"
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm"
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
          <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Add an expense category before recording an expense.
          </div>
        ) : null}
        {expensesQuery.isFetching ? <p className="py-4 text-sm text-slate-500">Loading…</p> : null}
        {expensesQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {errorMessage(expensesQuery.error, 'Failed to load expenses.')}
          </p>
        ) : null}
        {expensesQuery.data && expenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No expenses in this period.</p>
        ) : null}
        {expenses.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                  <th className="py-2 pr-2 font-medium">BS date</th>
                  <th className="py-2 pr-2 font-medium">Category</th>
                  <th className="py-2 pr-2 font-medium">Payee</th>
                  <th className="py-2 pr-2 font-medium">Note</th>
                  <th className="py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((expense) => (
                  <tr key={expense.id} className="border-b border-slate-100">
                    <td className="py-2 pr-2 whitespace-nowrap">{expense.business_date_bs}</td>
                    <td className="py-2 pr-2 font-medium">{expense.category_name}</td>
                    <td className="py-2 pr-2">{expense.payee || '—'}</td>
                    <td className="py-2 pr-2 text-slate-600">{expense.note || '—'}</td>
                    <td className="py-2 text-right font-semibold">{formatNpr(expense.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-slate-500">
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
            className="mb-4 flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-3"
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
              <p role="alert" className="basis-full text-sm text-red-600">
                {categoryError}
              </p>
            ) : null}
          </form>
        ) : null}
        {summaryQuery.isFetching ? (
          <p className="py-4 text-sm text-slate-500">Loading summary…</p>
        ) : null}
        {summaryQuery.isError ? (
          <p role="alert" className="py-4 text-sm text-red-600">
            {errorMessage(summaryQuery.error, 'Failed to load the expense summary.')}
          </p>
        ) : null}
        {summaryQuery.data ? (
          <>
            <p className="mb-3 text-lg font-semibold">
              Total: {formatNpr(summaryQuery.data.total)}
            </p>
            {summaryQuery.data.groups.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                    <th className="py-2 pr-2 font-medium">Category</th>
                    <th className="py-2 pr-2 text-right font-medium">Entries</th>
                    <th className="py-2 text-right font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {summaryQuery.data.groups.map((group) => (
                    <tr key={group.key} className="border-b border-slate-100">
                      <td className="py-2 pr-2">{group.key}</td>
                      <td className="py-2 pr-2 text-right">{group.count}</td>
                      <td className="py-2 text-right font-semibold">{formatNpr(group.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-sm text-slate-500">No grouped expenses in this period.</p>
            )}
          </>
        ) : null}
      </Card>
    </main>
  );
}
