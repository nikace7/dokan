import { Link } from 'react-router-dom';

import { Card } from '@/components/ui/Card';

/**
 * Placeholder for the simple sale screen. The full counter UI lands next;
 * this keeps the route registered so plan-gated navigation stays green.
 */
export function SimpleSalePage() {
  return (
    <main className="mx-auto max-w-xl p-4">
      <Card title="Simple sale / सरल बिक्री">
        <p className="text-sm text-muted-foreground">
          Simple sale coming next. Ask your platform admin to enable the Advanced POS if
          you need barcode billing today.
        </p>
        <Link to="/" className="mt-3 inline-block text-sm text-primary hover:underline">
          Back to dashboard
        </Link>
      </Card>
    </main>
  );
}
