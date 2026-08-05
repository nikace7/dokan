import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { usePlatformAuth } from '@/features/admin/usePlatformAuth';

export function PlatformLoginPage() {
  const auth = usePlatformAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');

  if (auth.isAuthenticated) return <Navigate to="/admin" replace />;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void auth.signIn(email.trim(), password, otp).then(() => navigate('/admin', { replace: true }));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-4">
      <Card className="w-full max-w-md" title="Dokan platform control plane">
        <p className="mb-4 text-sm text-slate-600">
          Restricted to approved networks. Password and authenticator code are required.
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Input
            label="Email"
            type="email"
            autoComplete="username"
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
          />
          {auth.loginError ? (
            <p role="alert" className="text-sm text-red-700">
              {auth.loginError}
            </p>
          ) : null}
          <Button type="submit" size="lg" disabled={auth.isLoggingIn || otp.length !== 6}>
            {auth.isLoggingIn ? 'Verifying…' : 'Sign in securely'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
