import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/label';
import {
  createCategory,
  createExpense,
  fetchExpenseSummary,
  listCategories,
  listExpenses,
} from '@/features/expenses/api';
import type { ExpensePayload } from '@/features/expenses/api';
import { ExpenseList, SummaryGroups } from '@/features/expenses/ExpenseTables';
import { currentBsMonthRange } from '@/features/reports/api';
import { BsRangeControls } from '@/features/reports/BsRangeControls';
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

/** Owner-facing expense entry and BS-period summary. */
export function ExpensesPage() {
  const { t } = useTranslation();
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
      setStatusMessage(t('expenses.saved'));
    },
    onError: (error) => setFormError(errorMessage(error, t('expenses.saveError'))),
  });

  const categoryMutation = useMutation({
    mutationFn: createCategory,
    onSuccess: (category) => {
      void queryClient.invalidateQueries({ queryKey: ['expenses', 'categories'] });
      setForm((current) => ({ ...current, category: category.id }));
      setCategoryName('');
      setCategoryError(null);
      setShowCategoryForm(false);
      setStatusMessage(t('expenses.summary.added'));
    },
    onError: (error) => setCategoryError(errorMessage(error, t('expenses.summary.addError'))),
  });

  const expenses = expensesQuery.data?.data ?? [];
  const meta = expensesQuery.data?.meta ?? null;
  const categories = categoriesQuery.data?.data ?? [];

  function submitExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.category || !form.amount || !form.business_date_ad) {
      setFormError(t('expenses.required'));
      return;
    }
    createMutation.mutate({
      ...form,
      amount: form.amount.trim(),
      payee: form.payee?.trim(),
      note: form.note?.trim(),
    });
  }

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-4 p-4">
      {statusMessage ? (
        <p role="status" className="rounded-md bg-accent px-3 py-2 text-sm text-accent-foreground">
          {statusMessage}
        </p>
      ) : null}

      <Card
        title={t('expenses.title')}
        actions={
          <Button
            size="sm"
            onClick={() => {
              setShowForm((current) => !current);
              setStatusMessage(null);
              setFormError(null);
            }}
          >
            {showForm ? t('common.closeForm') : t('expenses.add')}
          </Button>
        }
      >
        {showForm ? (
          <form onSubmit={submitExpense} className="mb-4 rounded-md border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="expense-category">{t('expenses.category')}</Label>
                <select
                  id="expense-category"
                  aria-label={t('expenses.category')}
                  value={form.category}
                  onChange={(event) => setForm({ ...form, category: event.target.value })}
                  className={selectClasses}
                >
                  <option value="">{t('expenses.selectCategory')}</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <Input
                label={t('common.amountNpr')}
                type="number"
                min="0.01"
                step="0.01"
                value={form.amount}
                onChange={(event) => setForm({ ...form, amount: event.target.value })}
              />
              <Input
                label={t('expenses.businessDate')}
                type="date"
                value={form.business_date_ad}
                onChange={(event) => setForm({ ...form, business_date_ad: event.target.value })}
              />
              <Input
                label={t('expenses.payee')}
                value={form.payee}
                onChange={(event) => setForm({ ...form, payee: event.target.value })}
              />
            </div>
            <div className="mt-3 flex flex-col gap-1.5">
              <Label htmlFor="expense-note">{t('common.note')}</Label>
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
                {createMutation.isPending ? t('common.saving') : t('expenses.save')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        ) : null}

        <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="expense-filter-category">{t('expenses.filterCategory')}</Label>
            <select
              id="expense-filter-category"
              aria-label={t('expenses.filterCategoryAria')}
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
              className={selectClasses}
            >
              <option value="">{t('expenses.allCategories')}</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </div>
          <BsRangeControls
            value={{ dateFromBs, dateToBs }}
            onApply={(range) => {
              setDateFromBs(range.dateFromBs);
              setDateToBs(range.dateToBs);
              setPage(1);
            }}
          />
        </div>

        {categories.length === 0 && !categoriesQuery.isFetching ? (
          <div className="mb-4 rounded-md border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
            {t('expenses.needCategory')}
          </div>
        ) : null}
        {expensesQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : null}
        {expensesQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(expensesQuery.error, t('expenses.loadError'))}
          </p>
        ) : null}
        {expensesQuery.data && expenses.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('expenses.empty')}</p>
        ) : null}
        {expenses.length > 0 ? <ExpenseList expenses={expenses} /> : null}
        {meta && meta.total_pages > 1 ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {t('common.pageOf', { page: meta.page, total: meta.total_pages })} (
              {t('expenses.count', { count: meta.count })})
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((current) => current - 1)}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={meta.page >= meta.total_pages}
                onClick={() => setPage((current) => current + 1)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card
        title={t('expenses.summary.title')}
        actions={
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowCategoryForm((current) => !current)}
          >
            {showCategoryForm
              ? t('expenses.summary.closeCategoryForm')
              : t('expenses.summary.addCategory')}
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
              label={t('expenses.summary.categoryName')}
              value={categoryName}
              onChange={(event) => setCategoryName(event.target.value)}
            />
            <Button
              type="submit"
              size="sm"
              disabled={categoryMutation.isPending || !categoryName.trim()}
            >
              {categoryMutation.isPending
                ? t('expenses.summary.adding')
                : t('expenses.summary.addCategory')}
            </Button>
            {categoryError ? (
              <p role="alert" className="basis-full text-sm text-destructive">
                {categoryError}
              </p>
            ) : null}
          </form>
        ) : null}
        {summaryQuery.isFetching ? (
          <p className="py-4 text-sm text-muted-foreground">{t('expenses.summary.loading')}</p>
        ) : null}
        {summaryQuery.isError ? (
          <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {errorMessage(summaryQuery.error, t('expenses.summary.loadError'))}
          </p>
        ) : null}
        {summaryQuery.data ? (
          <>
            <p className="mb-3 text-lg font-semibold">
              {t('expenses.summary.total')}: {formatNpr(summaryQuery.data.total)}
            </p>
            {summaryQuery.data.groups.length > 0 ? (
              <SummaryGroups groups={summaryQuery.data.groups} />
            ) : (
              <p className="text-sm text-muted-foreground">{t('expenses.summary.empty')}</p>
            )}
          </>
        ) : null}
      </Card>
    </main>
  );
}
