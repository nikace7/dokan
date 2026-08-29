import { useCallback, useEffect, useState } from 'react';

import { getSite } from './lib/api';
import type { SiteInfo } from './lib/api';
import { resolveTemplate } from './templates';

type SiteState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; site: SiteInfo };

export default function App() {
  const [state, setState] = useState<SiteState>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    getSite()
      .then((site) => setState({ status: 'ready', site }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message:
            err instanceof Error
              ? err.message
              : 'We could not reach the store right now. Please try again.',
        }),
      );
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf9f6]">
        <div className="w-full max-w-5xl animate-pulse px-5" aria-label="Loading the shop">
          <div className="h-10 w-1/3 rounded bg-black/10" />
          <div className="mt-4 h-4 w-1/4 rounded bg-black/10" />
          <div className="mt-12 grid grid-cols-2 gap-6 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <div className="aspect-[4/5] rounded bg-black/10" />
                <div className="mt-3 h-4 w-2/3 rounded bg-black/10" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#faf9f6] px-6 text-center">
        <p className="font-serif text-3xl tracking-tight text-[#1a1a18]">The shop is closed</p>
        <p className="mt-3 max-w-sm text-sm text-[#1a1a18]/60">{state.message}</p>
        <button
          type="button"
          onClick={load}
          className="mt-6 border border-[#1a1a18] px-6 py-2.5 text-xs uppercase tracking-[0.2em] text-[#1a1a18] transition-colors hover:bg-[#1a1a18] hover:text-[#faf9f6]"
        >
          Try again
        </button>
      </div>
    );
  }

  const Template = resolveTemplate(state.site.template);
  return <Template site={state.site} />;
}
