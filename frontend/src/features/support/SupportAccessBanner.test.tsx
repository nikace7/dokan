import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupportAccessBanner } from '@/features/support/SupportAccessBanner';
import { clearTokens, setTokens } from '@/lib/auth/tokens';

const fetchMock = vi.fn<typeof fetch>();

function token(payload: Record<string, unknown>): string {
  return `x.${btoa(JSON.stringify(payload)).replace(/=/g, '')}.x`;
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderBanner(onEnded = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <SupportAccessBanner onEnded={onEnded} />
    </QueryClientProvider>,
  );
  return onEnded;
}

describe('SupportAccessBanner', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({
      access: token({
        act: 'platform-1',
        jti: 'session-1',
        scope: 'read_only',
        exp: 2_000_000_000,
      }),
      refresh: '',
    });
    fetchMock.mockResolvedValue(
      envelope({
        id: 'session-1',
        platform_user_name: 'Ram Support',
        scope: 'READ_ONLY',
        expires_at: '2033-05-18T03:33:20Z',
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('stays visible and lets the acting support user end the session', async () => {
    const onEnded = renderBanner();

    expect(await screen.findByText(/Ram Support/)).toBeInTheDocument();
    expect(screen.getByText(/read only/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /end support session/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/v1/support-access/session-1/end'),
        expect.objectContaining({ method: 'POST' }),
      );
      expect(onEnded).toHaveBeenCalledOnce();
    });
  });
});
