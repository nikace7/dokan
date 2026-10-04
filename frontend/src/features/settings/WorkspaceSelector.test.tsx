import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceSelector } from '@/features/settings/WorkspaceSelector';

const setBranchId = vi.fn();
const setRateTypeId = vi.fn();

const BRANCHES = [
  { id: 'b1', name: 'Main Branch', is_default: true },
  { id: 'b2', name: 'Lakeside', is_default: false },
];
const RATE_TYPES = [
  { id: 'r1', name: 'Retail', is_default: true },
  { id: 'r2', name: 'Wholesale', is_default: false },
];

interface MockWorkspace {
  branches: typeof BRANCHES;
  rateTypes: typeof RATE_TYPES;
  branchId: string | null;
  rateTypeId: string | null;
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
}

const BASE_WORKSPACE: MockWorkspace = {
  branches: BRANCHES,
  rateTypes: RATE_TYPES,
  branchId: 'b1',
  rateTypeId: 'r1',
  isReady: true,
  isLoading: false,
  error: null,
};

let mockWorkspace: MockWorkspace = BASE_WORKSPACE;

vi.mock('@/features/settings/useWorkspace', () => ({
  useWorkspace: () => ({ ...mockWorkspace, setBranchId, setRateTypeId }),
}));

function renderSelector(workspace?: Partial<MockWorkspace>) {
  mockWorkspace = { ...BASE_WORKSPACE, ...workspace };
  return render(<WorkspaceSelector />);
}

describe('WorkspaceSelector', () => {
  it('shows the active branch and rate as one chip', () => {
    renderSelector();
    const chip = screen.getByRole('button', { name: /switch branch or rate/i });
    expect(within(chip).getByText('Main Branch')).toBeInTheDocument();
    expect(within(chip).getByText('Retail')).toBeInTheDocument();
  });

  it('opens a labeled popover and switches both values', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: /switch branch or rate/i }));

    const branchGroup = screen.getByRole('group', { name: 'Branch' });
    const rateGroup = screen.getByRole('group', { name: 'Rate type' });
    // The active rows carry the check (aria-pressed); inactive ones don't.
    expect(within(branchGroup).getByRole('button', { name: 'Main Branch' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(branchGroup).getByRole('button', { name: 'Lakeside' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );

    fireEvent.click(within(branchGroup).getByRole('button', { name: 'Lakeside' }));
    expect(setBranchId).toHaveBeenCalledWith('b2');
    // The popover stays open so the rate can follow in the same visit.
    fireEvent.click(within(rateGroup).getByRole('button', { name: 'Wholesale' }));
    expect(setRateTypeId).toHaveBeenCalledWith('r2');
  });

  it('hides a group that has nothing to switch', () => {
    renderSelector({ branches: [BRANCHES[0]] });
    fireEvent.click(screen.getByRole('button', { name: /switch branch or rate/i }));
    expect(screen.queryByRole('group', { name: 'Branch' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Rate type' })).toBeInTheDocument();
  });

  it('renders a static readout when there is nothing to switch at all', () => {
    renderSelector({ branches: [BRANCHES[0]], rateTypes: [RATE_TYPES[0]] });
    expect(
      screen.queryByRole('button', { name: /switch branch or rate/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Main Branch')).toBeInTheDocument();
    expect(screen.getByText('Retail')).toBeInTheDocument();
  });

  it('keeps the loading and error readouts', () => {
    renderSelector({ isLoading: true, isReady: false });
    expect(screen.getByText(/loading shop/i)).toBeInTheDocument();
    renderSelector({ isLoading: false, isReady: false, error: new Error('down') });
    expect(screen.getByText(/unavailable/i)).toBeInTheDocument();
  });
});
