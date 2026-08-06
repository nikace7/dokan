import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Card } from '@/components/ui/Card';
import { getItem } from '@/features/catalog/api';
import { ItemForm } from '@/features/catalog/ItemForm';

/** Create/edit host: `/catalog/items/new` and `/catalog/items/:id/edit`. */
export function ItemFormPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = id !== undefined;

  const itemQuery = useQuery({
    queryKey: ['catalog', 'items', 'detail', id],
    queryFn: () => getItem(id ?? ''),
    enabled: isEdit,
  });

  if (isEdit && itemQuery.isPending) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </main>
    );
  }
  if (isEdit && itemQuery.isError) {
    return (
      <main className="mx-auto max-w-3xl p-4">
        <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          {itemQuery.error instanceof Error ? itemQuery.error.message : 'Item not found.'}
        </p>
        <Link className="mt-2 inline-block text-primary hover:underline" to="/catalog">
          Back to items
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-4">
      <Card title={isEdit ? `Edit item ${itemQuery.data?.code ?? ''}` : 'New item'}>
        <ItemForm
          initial={itemQuery.data}
          onSaved={(item) => navigate(`/catalog/items/${item.id}`)}
        />
      </Card>
    </main>
  );
}
