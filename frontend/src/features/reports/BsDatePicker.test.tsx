import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BsDatePicker } from '@/features/reports/BsDatePicker';

describe('BsDatePicker', () => {
  it('selects a real Bikram Sambat day from the calendar grid', () => {
    const onChange = vi.fn();
    render(<BsDatePicker id="from-bs" label="From (BS)" value="2083-04-15" onChange={onChange} />);

    expect(screen.getByLabelText('From (BS)')).toHaveValue('2083-04-15');
    fireEvent.click(screen.getByRole('button', { name: 'Choose From (BS)' }));

    expect(screen.getByText('Shrawan 2083')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '20 Shrawan 2083' }));

    expect(onChange).toHaveBeenCalledWith('2083-04-20');
  });

  it('navigates by BS month without converting the displayed month to AD', () => {
    render(<BsDatePicker id="to-bs" label="To (BS)" value="2083-04-15" onChange={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Choose To (BS)' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next BS month' }));

    expect(screen.getByText('Bhadra 2083')).toBeInTheDocument();
  });
});
