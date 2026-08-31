import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReportActions } from '@/features/reports/ReportActions';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();
const printMock = vi.fn();
const clickMock = vi.fn();

describe('ReportActions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('print', printMock);
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickMock);
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:report'),
      revokeObjectURL: vi.fn(),
    });
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
  });

  afterEach(() => {
    delete document.documentElement.dataset.reportPrint;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    printMock.mockReset();
    clickMock.mockReset();
    clearTokens();
  });

  it('downloads the active report with its BS filters', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('xlsx', {
        headers: { 'Content-Disposition': 'attachment; filename="daily-sales.xlsx"' },
      }),
    );
    render(
      <ReportActions
        canExport
        report="daily-sales"
        params={{ date_from_bs: '2083-04-01', date_to_bs: '2083-04-20' }}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Download Excel' }));

    await waitFor(() => expect(clickMock).toHaveBeenCalledOnce());
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'report=daily-sales&date_from_bs=2083-04-01&date_to_bs=2083-04-20',
    );
  });

  it.each([
    ['Print A4', 'a4'],
    ['Print 80mm', 'thermal'],
  ])('activates %s layout while the print dialog opens', (label, format) => {
    printMock.mockImplementation(() => {
      expect(document.documentElement.dataset.reportPrint).toBe(format);
    });
    render(<ReportActions canExport report="dues" />);

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(printMock).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.reportPrint).toBeUndefined();
  });

  it('does not offer Excel when the tenant plan excludes it', () => {
    render(<ReportActions canExport={false} report="dues" />);

    expect(screen.queryByRole('button', { name: 'Download Excel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print A4' })).toBeInTheDocument();
  });
});
