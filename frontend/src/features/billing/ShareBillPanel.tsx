import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { toast } from '@/components/ui/sonner';
import { shareSale } from '@/features/billing/api';
import type { SalesInvoice } from '@/features/billing/api';
import { ApiError } from '@/lib/api/client';

interface ShareBillPanelProps {
  invoice: SalesInvoice;
}

function billUrl(shareUrlPath: string): string {
  // Always absolute on the current origin — the same host the counter used,
  // so the customer opens the bill on the shop's own subdomain.
  return `${window.location.origin}${shareUrlPath}`;
}

/**
 * Share actions for a completed bill: mint (or reuse) the public token,
 * then hand the link to the OS share sheet, the clipboard, or WhatsApp.
 */
export function ShareBillPanel({ invoice }: ShareBillPanelProps) {
  const [url, setUrl] = useState<string | null>(null);

  const shareMutation = useMutation({
    mutationFn: () => shareSale(invoice.id),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        toast.error('You do not have permission to share bills. / बिल सेयर गर्ने अनुमति छैन।');
      } else {
        toast.error('Could not create the share link. Try again. / लिङ्क बन्न सकेन।');
      }
    },
  });

  const share = async () => {
    let link = url;
    if (!link) {
      try {
        const result = await shareMutation.mutateAsync();
        link = billUrl(result.share_url_path);
        setUrl(link);
      } catch {
        return; // onError already toasted the reason
      }
    }
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Bill ${invoice.invoice_prefix}-${invoice.invoice_no}`, url: link });
        return;
      } catch {
        // Share sheet dismissed or unavailable — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success('Link copied / लिङ्क कपी भयो');
    } catch {
      toast.error('Copy failed — long-press the link instead. / कपी भएन।');
    }
  };

  return (
    <Card title="Share bill / बिल सेयर" className="mx-auto mt-4 max-w-lg">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={shareMutation.isPending}
          onClick={() => void share()}
        >
          {shareMutation.isPending ? 'Creating link…' : 'Share link / लिङ्क सेयर'}
        </Button>
        <Button asChild variant="secondary" size="lg" disabled={url === null}>
          <a
            href={url ? `https://wa.me/?text=${encodeURIComponent(url)}` : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={url === null}
          >
            WhatsApp
          </a>
        </Button>
      </div>
      {url ? (
        <p className="mt-3 break-all rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {url}
        </p>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground">
          Create the link first, then send it on WhatsApp. पहिले लिङ्क बनाउनुहोस्।
        </p>
      )}
    </Card>
  );
}
