import { Download, Printer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { downloadReport } from '@/features/reports/api';
import type { ReportExportName } from '@/features/reports/api';

interface ReportActionsProps {
  canExport: boolean;
  report: ReportExportName;
  params?: Record<string, string | number | undefined>;
}

function openPrintDialog(format: 'a4' | 'thermal') {
  const root = document.documentElement;
  root.dataset.reportPrint = format;
  try {
    window.print();
  } finally {
    delete root.dataset.reportPrint;
  }
}

/** Shared Excel and deliberate A4/80mm print controls for report screens. */
export function ReportActions({ canExport, report, params = {} }: ReportActionsProps) {
  const { t } = useTranslation();
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    setDownloading(true);
    try {
      const file = await downloadReport(report, params);
      const url = URL.createObjectURL(file.blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = file.filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t('reports.actions.downloadFailed', { defaultValue: 'Could not download the report.' }),
      );
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="report-print-actions flex flex-wrap justify-end gap-1">
      {canExport ? (
        <Button variant="outline" size="sm" loading={downloading} onClick={download}>
          <Download aria-hidden="true" />
          {t('reports.actions.excel', { defaultValue: 'Download Excel' })}
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => openPrintDialog('a4')}>
        <Printer aria-hidden="true" />
        {t('reports.actions.printA4', { defaultValue: 'Print A4' })}
      </Button>
      <Button variant="outline" size="sm" onClick={() => openPrintDialog('thermal')}>
        <Printer aria-hidden="true" />
        {t('reports.actions.printThermal', { defaultValue: 'Print 80mm' })}
      </Button>
    </div>
  );
}
