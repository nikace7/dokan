import { useState } from 'react';
import type { FormEvent } from 'react';

import { requestOtp, verifyOtp } from '../lib/api';
import { useCommerce } from './CommerceProvider';

export function EmailLogin() {
  const { setSession } = useCommerce();
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await requestOtp(email.trim());
      setCodeSent(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not send the login code.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setSession(await verifyOtp(email.trim(), code.trim()));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not verify that code.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mx-auto max-w-md rounded-2xl border border-[#1a1a18]/10 bg-white p-6 shadow-xs">
      <p className="text-xs uppercase tracking-[0.22em] text-[#6d2b2b]">Secure checkout</p>
      <h1 className="mt-2 font-serif text-3xl">Continue with email</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#1a1a18]/60">
        We will email a six-digit code. There is no password to remember.
      </p>
      {!codeSent ? (
        <form onSubmit={send} className="mt-6 space-y-4">
          <label className="block text-sm font-medium">
            Email address
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full rounded-lg border border-[#1a1a18]/20 bg-transparent px-3 py-3 outline-hidden focus:border-[#1a1a18]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-[#1a1a18] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Sending…' : 'Send login code'}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-6 space-y-4">
          <p className="text-sm text-[#1a1a18]/65">Code sent to {email}</p>
          <label className="block text-sm font-medium">
            6-digit code
            <input
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
              autoComplete="one-time-code"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              className="mt-2 w-full rounded-lg border border-[#1a1a18]/20 bg-transparent px-3 py-3 text-center text-2xl tracking-[0.35em] outline-hidden focus:border-[#1a1a18]"
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6}
            className="w-full rounded-lg bg-[#1a1a18] px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
          <button type="button" onClick={() => setCodeSent(false)} className="w-full text-sm underline">
            Use a different email
          </button>
        </form>
      )}
      {error ? <p role="alert" className="mt-4 text-sm text-[#8c2f2f]">{error}</p> : null}
    </section>
  );
}
