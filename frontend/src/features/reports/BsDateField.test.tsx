import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { BsDateField } from '@/features/reports/BsDateField';

function Form({ onSubmit, initial = '' }: { onSubmit: (ad: string) => void; initial?: string }) {
  const [ad, setAd] = useState(initial);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(ad);
      }}
    >
      <BsDateField id="until" label="Until" value={ad} onChange={setAd} />
      <button type="button" onClick={() => setAd('2026-08-03')}>
        reset
      </button>
      <button>save</button>
    </form>
  );
}

const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('Until'), { target: { value } });
const save = () => fireEvent.click(screen.getByRole('button', { name: 'save' }));

describe('BsDateField', () => {
  it('shows BS and hands over AD', () => {
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} initial="2026-08-03" />);
    expect(screen.getByLabelText('Until')).toHaveValue('2083-04-18');
    type('2083-04-19');
    save();
    expect(onSubmit).toHaveBeenLastCalledWith('2026-08-04');
    type('');
    save();
    expect(onSubmit).toHaveBeenLastCalledWith('');
  });

  it('never saves an unreadable date as no date', () => {
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);
    type('2083-04');
    expect(screen.queryByText(/Use BS dates/)).not.toBeInTheDocument(); // still typing
    fireEvent.blur(screen.getByLabelText('Until'));
    expect(screen.getByText(/Use BS dates/)).toBeInTheDocument();
    save();
    expect(onSubmit).not.toHaveBeenCalled();
    type('2083-04-18');
    save();
    expect(onSubmit).toHaveBeenCalledWith('2026-08-03');
  });

  it('follows a value changed from outside', () => {
    render(<Form onSubmit={vi.fn()} />);
    type('2083-04');
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));
    expect(screen.getByLabelText('Until')).toHaveValue('2083-04-18');
  });
});
