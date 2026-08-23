import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ItemImage } from '@/features/catalog/ui';

describe('ItemImage', () => {
  it('renders the photo when a URL is set', () => {
    render(<ItemImage imageUrl="/media/tenants/t1/items/a.png" alt="T-Shirt" />);
    expect(screen.getByRole('img', { name: 'T-Shirt' })).toHaveAttribute(
      'src',
      '/media/tenants/t1/items/a.png',
    );
  });

  it('renders the placeholder tile when no URL is set', () => {
    const { container } = render(<ItemImage imageUrl={null} alt="T-Shirt" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('falls back to the placeholder when the photo file fails to load', () => {
    render(<ItemImage imageUrl="/media/gone.png" alt="T-Shirt" />);
    fireEvent.error(screen.getByRole('img', { name: 'T-Shirt' }));
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
