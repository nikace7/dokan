import { KeyRound, Lock, Store } from 'lucide-react';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import brandMark from '@/assets/brand-mark.webp';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

/** Left brand panel (desktop only): what this console is and who it is for. */
function BrandPanel() {
  const points = [
    { icon: Store, text: 'Provision, suspend, and support every tenant shop from one place.' },
    { icon: KeyRound, text: 'Separate auth realm — platform tokens never touch a tenant session.' },
    { icon: Lock, text: 'Restricted networks, mandatory authenticator codes, full audit trail.' },
  ];
  return (
    <div
      className="relative hidden flex-col justify-between overflow-hidden bg-primary p-10 text-primary-foreground lg:flex"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 20%, hsl(var(--tint-green) / 0.18), transparent 45%),' +
          'radial-gradient(circle at 80% 70%, hsl(var(--tint-blue) / 0.14), transparent 40%)',
      }}
    >
      {/* Subtle dot texture */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage: 'radial-gradient(hsl(0 0% 100% / 0.35) 1px, transparent 1px)',
          backgroundSize: '22px 22px',
        }}
      />
      <div className="relative flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white shadow-sm">
          <img src={brandMark} alt="" className="h-7 w-7" />
        </span>
        <span className="text-xl font-bold">mero-pasal Control</span>
      </div>
      <div className="relative space-y-6">
        <p className="max-w-md text-3xl font-bold leading-snug tracking-tight">
          The control plane for every mero-pasal shop.
        </p>
        <ul className="space-y-3">
          {points.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm font-medium">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/15 [&_svg]:size-4">
                <Icon />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </div>
      <p className="relative text-xs text-primary-foreground/70">
        Authorized platform staff only. Every action here is audited.
      </p>
    </div>
  );
}

/**
 * Platform login — email + password + TOTP against the admin-host auth
 * realm. English only (the admin portal has no i18n).
 *
 * Desktop: brand panel left, sign-in card right. Mobile: single centered card.
 */
export function PlatformLoginPage() {
  const auth = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');

  if (auth.isAuthenticated) return <Navigate to="/admin" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void auth
      .signIn(email.trim(), password, otp)
      .then(() => navigate('/admin', { replace: true }))
      .catch(() => {
        // Failure is already surfaced via loginError from the mutation.
      });
  };

  return (
    <main className="grid min-h-screen bg-muted/40 lg:grid-cols-2">
      <BrandPanel />

      <div className="flex items-center justify-center p-6">
        <div className="flex w-full max-w-sm flex-col items-center">
          {/* Mobile-only brand header (desktop has the brand panel). */}
          <div className="mb-6 flex flex-col items-center gap-2 lg:hidden">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-card">
              <img src={brandMark} alt="" className="h-11 w-11" />
            </span>
            <span className="text-2xl font-bold tracking-tight">mero-pasal Control</span>
          </div>

          <Card className="w-full shadow-card">
            <CardHeader className="space-y-1 pb-4 text-center">
              <CardTitle className="text-xl">Platform sign in</CardTitle>
              <CardDescription>Password and authenticator code are required.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="flex flex-col gap-4">
                <Input
                  label="Email"
                  type="email"
                  autoComplete="username"
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
                <Input
                  label="Password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <Input
                  label="Authentication code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="text-center font-mono text-lg tracking-[0.5em]"
                  placeholder="••••••"
                />
                {auth.loginError ? (
                  <p
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                  >
                    {auth.loginError}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  loading={auth.isLoggingIn}
                  disabled={auth.isLoggingIn || otp.length !== 6}
                >
                  Sign in securely
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
