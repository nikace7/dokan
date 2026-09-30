import type { ReactNode } from 'react';

import type { SiteInfo } from '../lib/api';
import { useCommerce } from './CommerceProvider';

export function CommerceShell({
  site,
  children,
}: {
  site: SiteInfo;
  children: ReactNode;
}) {
  const { itemCount, session, signOut } = useCommerce();
  return (
    <div className="min-h-screen bg-[#faf9f6] text-[#1a1a18]">
      <header className="sticky top-0 z-30 border-b border-[#1a1a18]/10 bg-[#faf9f6]/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <a href="/" className="font-serif text-xl tracking-tight">
            {site.shop_name}
          </a>
          <nav className="flex items-center gap-4 text-xs font-medium uppercase tracking-[0.16em]">
            <a href="/orders" className="hover:underline">
              Orders
            </a>
            <a href="/cart" className="rounded-full bg-[#1a1a18] px-4 py-2 text-[#faf9f6]">
              Bag ({itemCount})
            </a>
          </nav>
        </div>
      </header>
      {children}
      <footer className="mt-20 border-t border-[#1a1a18]/10 px-5 py-8 text-center text-sm text-[#1a1a18]/60">
        <p>{site.contact.address || site.shop_name}</p>
        {site.contact.phone ? <a href={`tel:${site.contact.phone}`}>{site.contact.phone}</a> : null}
        {session ? (
          <button type="button" onClick={signOut} className="ml-4 underline">
            Sign out {session.customer.email}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

export function CommerceDock() {
  const { itemCount } = useCommerce();
  return (
    <nav
      aria-label="Shopping actions"
      className="fixed bottom-5 right-5 z-40 flex overflow-hidden rounded-full border border-white/20 bg-[#1a1a18] text-xs font-semibold uppercase tracking-[0.16em] text-white shadow-2xl"
    >
      <a href="/orders" className="px-4 py-3 hover:bg-white/10">
        Orders
      </a>
      <a href="/cart" className="border-l border-white/20 px-4 py-3 hover:bg-white/10">
        Bag ({itemCount})
      </a>
    </nav>
  );
}
