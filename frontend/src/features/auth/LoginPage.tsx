import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/features/auth/useAuth';

interface LocationState {
  from?: { pathname?: string };
}

/**
 * Login — phone + password against the host tenant's SimpleJWT endpoint.
 *
 * The tenant comes from the subdomain the page is served from, so there is
 * no shop picker here; a user logging in on the wrong subdomain simply has
 * no account.
 */
export function LoginPage() {
  const { isAuthenticated, isRestoring, isLoggingIn, loginError, signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');

  if (isAuthenticated) {
    const from = (location.state as LocationState | null)?.from?.pathname ?? '/';
    return <Navigate to={from} replace />;
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void signIn(phone.trim(), password).then(() => navigate('/', { replace: true }));
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-3xl font-bold text-blue-700">दोकान</h1>
        <p className="mt-1 text-center text-sm text-slate-500">Sign in to your shop</p>

        <form className="mt-6 flex flex-col gap-4" onSubmit={onSubmit}>
          <Input
            label="Phone / फोन"
            name="phone"
            inputMode="tel"
            autoComplete="username"
            autoFocus
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="98XXXXXXXX"
          />
          <Input
            label="Password / पासवर्ड"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {loginError ? (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
              {loginError}
            </p>
          ) : null}

          <Button type="submit" size="lg" disabled={isLoggingIn || isRestoring}>
            {isLoggingIn ? 'Signing in…' : 'Sign in / प्रवेश'}
          </Button>
        </form>
      </div>
    </main>
  );
}
