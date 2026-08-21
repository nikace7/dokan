import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock('sonner', () => ({ toast: toastMock }));

import { _resetVersionCheck, checkVersion } from '@/lib/versionCheck';

const fetchMock = vi.fn<typeof fetch>();

function versionResponse(version: string): Response {
  return new Response(JSON.stringify({ version }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('versionCheck', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    _resetVersionCheck();
    toastMock.mockClear();
  });

  afterEach(() => {
    fetchMock.mockReset();
  });

  it('stays silent when the deployed build is still the boot build', async () => {
    fetchMock.mockResolvedValue(versionResponse('100'));
    await checkVersion(); // boot stamp
    await checkVersion(); // same build
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('toasts a reload prompt exactly once when a newer build appears', async () => {
    fetchMock.mockResolvedValueOnce(versionResponse('100'));
    await checkVersion(); // boot stamp = 100
    fetchMock.mockResolvedValue(versionResponse('200'));
    await checkVersion(); // update detected
    await checkVersion(); // do not nag on every poll
    expect(toastMock).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ id: 'app-update-available' }),
    );
  });

  it('no-ops when version.json is missing (dev server)', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));
    await checkVersion();
    await checkVersion();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it('survives offline polls and still detects a later update', async () => {
    fetchMock.mockResolvedValueOnce(versionResponse('100'));
    await checkVersion();
    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    await checkVersion();
    expect(toastMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(versionResponse('200'));
    await checkVersion();
    expect(toastMock).toHaveBeenCalledTimes(1);
  });
});
