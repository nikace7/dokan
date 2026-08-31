import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authedDownload, authedRequest, onSignedOut } from '@/lib/api/authed';
import { clearTokens, getAccessToken, getRefreshToken, setTokens } from '@/lib/auth/tokens';

function envelope(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: null }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorEnvelope(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ data: null, error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fetchMock = vi.fn<typeof fetch>();

describe('authedRequest', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    setTokens({ access: 'access-1', refresh: 'refresh-1' });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    clearTokens();
  });

  it('attaches the stored access token and unwraps the envelope', async () => {
    fetchMock.mockResolvedValueOnce(envelope({ hello: 'world' }));

    const data = await authedRequest<{ hello: string }>('/v1/auth/me');

    expect(data).toEqual({ hello: 'world' });
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer access-1');
  });

  it('refreshes once on 401 and retries with the new token', async () => {
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(401, 'TOKEN_EXPIRED', 'Token expired'))
      .mockResolvedValueOnce(envelope({ access: 'access-2', refresh: 'refresh-2' }))
      .mockResolvedValueOnce(envelope({ hello: 'world' }));

    const data = await authedRequest<{ hello: string }>('/v1/auth/me');

    expect(data).toEqual({ hello: 'world' });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Refresh went out with the old refresh token…
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(String(refreshUrl)).toContain('/v1/auth/token/refresh');
    expect(JSON.parse(String(refreshInit?.body))).toEqual({ refresh: 'refresh-1' });

    // …and the retry carried the rotated pair.
    const [, retryInit] = fetchMock.mock.calls[2];
    expect((retryInit?.headers as Headers).get('Authorization')).toBe('Bearer access-2');
    expect(getAccessToken()).toBe('access-2');
    expect(getRefreshToken()).toBe('refresh-2');
  });

  it('clears the session and notifies listeners when the refresh fails', async () => {
    const listener = vi.fn();
    const unsubscribe = onSignedOut(listener);
    fetchMock
      .mockResolvedValueOnce(errorEnvelope(401, 'TOKEN_EXPIRED', 'Token expired'))
      .mockResolvedValueOnce(errorEnvelope(401, 'TOKEN_INVALID', 'Refresh token invalid'));

    await expect(authedRequest('/v1/auth/me')).rejects.toMatchObject({ status: 401 });

    expect(getAccessToken()).toBeNull();
    expect(getRefreshToken()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('does not refresh on non-401 errors', async () => {
    fetchMock.mockResolvedValueOnce(errorEnvelope(400, 'VALIDATION_ERROR', 'Bad input'));

    await expect(authedRequest('/v1/auth/me')).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads a binary response with the same authenticated transport', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(['workbook']), {
        status: 200,
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': 'attachment; filename="daily-sales-2083-04-15.xlsx"',
        },
      }),
    );

    const download = await authedDownload('/v1/reports/export?report=daily-sales');

    expect(await download.blob.text()).toBe('workbook');
    expect(download.filename).toBe('daily-sales-2083-04-15.xlsx');
    const [, init] = fetchMock.mock.calls[0];
    expect((init?.headers as Headers).get('Authorization')).toBe('Bearer access-1');
    expect((init?.headers as Headers).get('Accept')).toContain('spreadsheetml');
  });
});
