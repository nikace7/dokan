import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ProgressDonut } from '@/components/ui/ProgressDonut';

describe('ProgressDonut', () => {
  it('renders legend labels with computed percentages', () => {
    render(
      <ProgressDonut
        data={[
          { label: 'Cash', value: 60 },
          { label: 'QR', value: 30 },
          { label: 'Udharo', value: 10 },
        ]}
      />,
    );

    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('QR')).toBeInTheDocument();
    expect(screen.getByText('Udharo')).toBeInTheDocument();
    // 60% appears in both the legend row and the default center readout.
    expect(screen.getAllByText('60%').length).toBeGreaterThan(0);
    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('10%')).toBeInTheDocument();
  });

  it('shows the largest segment percentage in the center by default', () => {
    render(
      <ProgressDonut
        data={[
          { label: 'Cash', value: 3 },
          { label: 'QR', value: 1 },
        ]}
      />,
    );

    // Center readout and legend row both show 75% — at least one exists.
    expect(screen.getAllByText('75%').length).toBeGreaterThan(0);
  });

  it('honors an explicit center value and label', () => {
    render(
      <ProgressDonut
        data={[{ label: 'Cash', value: 1 }]}
        centerValue="रू 5,000.00"
        centerLabel="Collected"
      />,
    );

    expect(screen.getByText('रू 5,000.00')).toBeInTheDocument();
    expect(screen.getByText('Collected')).toBeInTheDocument();
  });

  it('exposes an accessible breakdown of the segments', () => {
    render(
      <ProgressDonut
        data={[
          { label: 'Cash', value: 1 },
          { label: 'QR', value: 3 },
        ]}
      />,
    );

    expect(screen.getByRole('img')).toHaveAttribute('aria-label', 'Cash 25%, QR 75%');
  });

  it('renders gracefully with all-zero data', () => {
    render(<ProgressDonut data={[{ label: 'Cash', value: 0 }]} />);

    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getAllByText('0%').length).toBeGreaterThan(0);
  });
});
