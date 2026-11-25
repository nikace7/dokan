import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { Button } from '@/components/ui/Button';
import { HeaderActions } from '@/components/ui/HeaderActions';
import type { HeaderAction } from '@/components/ui/HeaderActions';

function renderActions(actions: HeaderAction[]) {
  render(
    <MemoryRouter>
      <HeaderActions actions={actions}>
        <Button>Add opening stock</Button>
      </HeaderActions>
    </MemoryRouter>,
  );
}

describe('HeaderActions', () => {
  it('gathers the secondary actions into one More menu for phones', () => {
    const onAdjust = vi.fn();
    renderActions([
      { label: 'Physical counts', to: '/stock/counts' },
      { label: 'Adjust stock', onSelect: onAdjust },
    ]);

    fireEvent.keyDown(screen.getByRole('button', { name: 'More' }), { key: 'Enter' });
    expect(screen.getByRole('menuitem', { name: 'Physical counts' })).toHaveAttribute(
      'href',
      '/stock/counts',
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Adjust stock' }));
    expect(onAdjust).toHaveBeenCalledOnce();
  });

  it('hides nothing behind a menu when there is only one action', () => {
    renderActions([{ label: 'Physical counts', to: '/stock/counts' }]);

    expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Physical counts' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add opening stock' })).toBeInTheDocument();
  });
});
