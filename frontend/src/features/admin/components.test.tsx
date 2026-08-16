import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  AdminCard,
  EmptyState,
  Field,
  LoadingRows,
  PageHeader,
  StatusBadge,
} from '@/features/admin/components';

describe('PageHeader', () => {
  it('renders title, description, and actions', () => {
    render(
      <PageHeader title="Tenants" description="Every shop on the platform." actions={<button>New</button>} />,
    );
    expect(screen.getByRole('heading', { name: 'Tenants' })).toBeInTheDocument();
    expect(screen.getByText('Every shop on the platform.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  });
});

describe('AdminCard', () => {
  it('renders the title and content', () => {
    render(
      <AdminCard title="Lifecycle" description="Suspend or reactivate.">
        <p>card body</p>
      </AdminCard>,
    );
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Suspend or reactivate.')).toBeInTheDocument();
    expect(screen.getByText('card body')).toBeInTheDocument();
  });
});

describe('StatusBadge', () => {
  it('maps each tenant status to a label and semantic variant', () => {
    render(
      <>
        <StatusBadge status="TRIAL" />
        <StatusBadge status="ACTIVE" />
        <StatusBadge status="PAST_DUE" />
        <StatusBadge status="SUSPENDED" />
        <StatusBadge status="CANCELLED" />
      </>,
    );
    expect(screen.getByText('Trial')).toHaveClass('bg-secondary');
    expect(screen.getByText('Active')).toHaveClass('bg-success');
    expect(screen.getByText('Past due')).toHaveClass('bg-warning');
    expect(screen.getByText('Suspended')).toHaveClass('bg-destructive');
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
  });
});

describe('Field', () => {
  it('wires the label to the control and shows the hint', () => {
    render(
      <Field label="Shop name" htmlFor="shop-name" hint="Shown on receipts.">
        <input id="shop-name" />
      </Field>,
    );
    expect(screen.getByLabelText('Shop name')).toBeInTheDocument();
    expect(screen.getByText('Shown on receipts.')).toBeInTheDocument();
  });

  it('prefers the error over the hint', () => {
    render(
      <Field label="Slug" htmlFor="slug" error="Already taken." hint="3–30 chars.">
        <input id="slug" />
      </Field>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Already taken.');
    expect(screen.queryByText('3–30 chars.')).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title, body, and action', () => {
    const onClick = vi.fn();
    render(
      <EmptyState title="No tenants yet" body="Provision the first shop." action={{ label: 'New tenant', onClick }} />,
    );
    expect(screen.getByText('No tenants yet')).toBeInTheDocument();
    expect(screen.getByText('Provision the first shop.')).toBeInTheDocument();
    screen.getByRole('button', { name: 'New tenant' }).click();
    expect(onClick).toHaveBeenCalledOnce();
  });
});

describe('LoadingRows', () => {
  it('renders the requested number of skeleton rows and columns', () => {
    const { container } = render(
      <table>
        <tbody>
          <LoadingRows columns={3} rows={2} />
        </tbody>
      </table>,
    );
    expect(container.querySelectorAll('tr')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(6);
  });
});
