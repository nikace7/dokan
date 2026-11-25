import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';

describe('page title', () => {
  it('names the browser tab after the screen and restores it on the way out', () => {
    document.title = 'mero-pasal.online — Complete Shop Management';
    const { unmount } = render(
      <Card title="Customers" titleAs="h1">
        x
      </Card>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Customers' })).toBeInTheDocument();
    expect(document.title).toBe('Customers · mero-pasal.online');
    unmount();
    expect(document.title).toBe('mero-pasal.online — Complete Shop Management');
  });

  it('follows a page header, and leaves the tab alone for a card inside the page', () => {
    render(
      <>
        <PageHeader title="Bills" />
        <Card title="History">x</Card>
      </>,
    );
    expect(document.title).toBe('Bills · mero-pasal.online');
    expect(screen.getByRole('heading', { level: 2, name: 'History' })).toBeInTheDocument();
  });
});
