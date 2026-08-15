import { Banknote } from 'lucide-react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatTile } from '@/components/ui/StatTile';

describe('StatTile', () => {
  it('renders the label and a money value formatted from integer paisa', () => {
    render(<StatTile label="Today sales" valuePaisa={12345600} icon={Banknote} />);

    expect(screen.getByText('Today sales')).toBeInTheDocument();
    expect(screen.getByText('रू 1,23,456.00')).toBeInTheDocument();
  });

  it('renders a pre-formatted text value when valuePaisa is not given', () => {
    render(<StatTile label="Low stock" value="12 items" icon={Banknote} tint="amber" />);

    expect(screen.getByText('12 items')).toBeInTheDocument();
  });

  it('renders an up trend as a green ▲ badge', () => {
    render(
      <StatTile
        label="Sales"
        valuePaisa={100}
        icon={Banknote}
        trend={{ percent: 12.5, label: 'vs last week' }}
      />,
    );

    const badge = screen.getByText(/12\.5%/);
    expect(badge).toHaveTextContent('▲');
    expect(badge).toHaveClass('bg-tint-green', 'text-tint-green-foreground');
    expect(screen.getByText('vs last week')).toBeInTheDocument();
  });

  it('renders a down trend as a red ▼ badge', () => {
    render(<StatTile label="Sales" valuePaisa={100} icon={Banknote} trend={{ percent: -8 }} />);

    const badge = screen.getByText(/8%/);
    expect(badge).toHaveTextContent('▼');
    expect(badge).toHaveClass('bg-tint-rose', 'text-tint-rose-foreground');
  });

  it('renders a skeleton without data when loading', () => {
    render(<StatTile label="Sales" valuePaisa={100} icon={Banknote} isLoading />);

    expect(screen.getByLabelText('Sales')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('रू 1.00')).not.toBeInTheDocument();
  });

  it('renders the footer caption', () => {
    render(<StatTile label="Sales" value="10" icon={Banknote} caption="12 bills" />);

    expect(screen.getByText('12 bills')).toBeInTheDocument();
  });
});
