import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ImageLightbox } from '@/components/ui/ImageLightbox';

describe('ImageLightbox', () => {
  it('renders nothing while imageUrl is null', () => {
    const { container } = render(
      <ImageLightbox imageUrl={null} alt="T-Shirt" onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the photo and closes on Escape, backdrop tap, and the close button', () => {
    const onClose = vi.fn();
    render(<ImageLightbox imageUrl="/media/x.png" alt="T-Shirt" onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'T-Shirt' });
    const photo = screen.getByRole('img', { name: 'T-Shirt' });
    expect(photo).toHaveAttribute('src', '/media/x.png');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(dialog); // backdrop tap dismisses
    expect(onClose).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(3);

    // Tapping the photo itself must never dismiss.
    fireEvent.click(photo);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
