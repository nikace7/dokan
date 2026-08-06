import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
  const [url, setUrl] = useState<string | null>(null);

  const shareMutation = useMutation({
    mutationFn: () => shareSale(invoice.id),
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) {
        toast.error(t('share.permissionDenied'));
      } else {
        toast.error(t('share.createFailed'));
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
        await navigator.share({
          title: t('share.billTitle', {
            number: `${invoice.invoice_prefix}-${invoice.invoice_no}`,
          }),
          url: link,
        });
        return;
      } catch {
        // Share sheet dismissed or unavailable — fall through to clipboard.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      toast.success(t('share.linkCopied'));
    } catch {
      toast.error(t('share.copyFailed'));
    }
  };

  return (
    <Card title={t('share.title')} className="mx-auto mt-4 max-w-lg">
      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          disabled={shareMutation.isPending}
          onClick={() => void share()}
        >
          {shareMutation.isPending ? t('share.creatingLink') : t('share.shareLink')}
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
        <p className="mt-3 text-xs text-muted-foreground">{t('share.createFirst')}</p>
      )}
    </Card>
  );
}
