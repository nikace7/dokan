/**
 * Deploy detection for the long-lived SPA. An open tab (or an installed PWA)
 * keeps running the build it booted with until something reloads it, so
 * "the new version is live but I don't see it" was a recurring support
 * complaint. Every build stamps a unique dist/version.json; we poll it
 * (interval + when the tab becomes visible) and, once it differs from the
 * boot build, show a sticky toast with a reload action.
 *
 * No-ops in dev (no version.json) and offline (poll simply fails and the
 * next one retries).
 */
import { toast } from 'sonner';

import i18n from '@/lib/i18n';

const VERSION_URL = '/version.json';
const POLL_INTERVAL_MS = 10 * 60_000;
const TOAST_ID = 'app-update-available';

let bootVersion: string | null = null;
let notified = false;

async function fetchVersion(): Promise<string | null> {
  try {
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) {
      return null;
    }
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && 'version' in body) {
      const version = (body as { version: unknown }).version;
      return typeof version === 'string' ? version : null;
    }
    return null;
  } catch {
    return null; // offline — the next poll retries
  }
}

export async function checkVersion(): Promise<void> {
  const version = await fetchVersion();
  if (version === null) {
    return;
  }
  if (bootVersion === null) {
    bootVersion = version;
    return;
  }
  if (version !== bootVersion && !notified) {
    notified = true;
    toast(i18n.t('common.updateAvailable'), {
      id: TOAST_ID,
      duration: Number.POSITIVE_INFINITY,
      action: {
        label: i18n.t('common.reload'),
        onClick: () => window.location.reload(),
      },
    });
  }
}

/** Start polling; returns the cleanup for React effect teardown. */
export function initVersionCheck(): () => void {
  void checkVersion();
  const interval = window.setInterval(() => void checkVersion(), POLL_INTERVAL_MS);
  const onVisible = () => {
    if (document.visibilityState === 'visible') {
      void checkVersion();
    }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', onVisible);
  };
}

/** Test hook: reset module state between tests. */
export function _resetVersionCheck(): void {
  bootVersion = null;
  notified = false;
}
