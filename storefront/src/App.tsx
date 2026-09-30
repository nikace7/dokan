import { createElement, useCallback, useEffect, useState } from 'react';

import { getSite } from './lib/api';
import type { SiteInfo } from './lib/api';
import { CartPage } from './commerce/CartPage';
import { CheckoutPage } from './commerce/CheckoutPage';
import { CommerceDock } from './commerce/CommerceShell';
import { OrdersPage } from './commerce/OrdersPage';
import { ProductPage } from './commerce/ProductPage';
import { TrackingPage } from './commerce/TrackingPage';
import { navigate, usePathname } from './commerce/router';
import { resolveTemplate } from './templates';

type SiteState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; site: SiteInfo };

export default function App() {
  const [state, setState] = useState<SiteState>({ status: 'loading' });
  const pathname = usePathname();

  // Only the async callbacks touch state here, so the mount effect can call
  // this without a synchronous setState (react-hooks/set-state-in-effect).
  const fetchSite = useCallback(() => {
    getSite()
      .then((site) => {
        document.title = site.shop_name;
        setState({ status: 'ready', site });
      })
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

  const load = useCallback(() => {
    setState({ status: 'loading' });
    fetchSite();
  }, [fetchSite]);

  useEffect(() => {
    fetchSite();
  }, [fetchSite]);

  if (state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#faf9f6]">
        <div className="w-full max-w-5xl animate-pulse px-5" aria-label="Loading the shop">
          <div className="h-10 w-1/3 rounded-sm bg-black/10" />
          <div className="mt-4 h-4 w-1/4 rounded-sm bg-black/10" />
          <div className="mt-12 grid grid-cols-2 gap-6 md:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i}>
                <div className="aspect-4/5 rounded-sm bg-black/10" />
                <div className="mt-3 h-4 w-2/3 rounded-sm bg-black/10" />
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

  const productMatch = pathname.match(/^\/product\/([^/]+)$/);
  const orderMatch = pathname.match(/^\/order\/([^/]+)$/);
  if (productMatch) return <ProductPage site={state.site} productId={decodeURIComponent(productMatch[1])} />;
  if (orderMatch) return <TrackingPage site={state.site} trackingToken={decodeURIComponent(orderMatch[1])} />;
  if (pathname === '/cart') return <CartPage site={state.site} />;
  if (pathname === '/checkout') return <CheckoutPage site={state.site} navigate={navigate} />;
  if (pathname === '/orders') return <OrdersPage site={state.site} />;
  if (pathname !== '/') return <div className="flex min-h-screen flex-col items-center justify-center bg-[#faf9f6] px-5"><h1 className="font-serif text-4xl">Page not found</h1><a href="/" className="mt-5 underline">Back to {state.site.shop_name}</a></div>;
  // resolveTemplate returns a module-level component, so its identity is stable
  // across renders; createElement avoids binding it to a render-local JSX tag
  // (react-hooks/static-components).
  return <>{createElement(resolveTemplate(state.site.template), { site: state.site })}<CommerceDock /></>;
}
