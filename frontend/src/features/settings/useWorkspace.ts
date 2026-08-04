import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { create } from 'zustand';

import { listBranches, listRateTypes } from '@/features/settings/api';
import type { Branch, RateType } from '@/features/settings/api';
import { hasTokens } from '@/lib/auth/tokens';

const BRANCH_STORAGE_KEY = 'dokan.workspace.branch';
const RATE_TYPE_STORAGE_KEY = 'dokan.workspace.rate-type';

function storedValue(key: string): string | null {
  return localStorage.getItem(key);
}

interface WorkspaceSelection {
  branchId: string | null;
  rateTypeId: string | null;
  setBranchId: (branchId: string | null) => void;
  setRateTypeId: (rateTypeId: string | null) => void;
}

const useWorkspaceSelection = create<WorkspaceSelection>((set) => ({
  branchId: storedValue(BRANCH_STORAGE_KEY),
  rateTypeId: storedValue(RATE_TYPE_STORAGE_KEY),
  setBranchId: (branchId) => {
    if (branchId) localStorage.setItem(BRANCH_STORAGE_KEY, branchId);
    else localStorage.removeItem(BRANCH_STORAGE_KEY);
    set({ branchId });
  },
  setRateTypeId: (rateTypeId) => {
    if (rateTypeId) localStorage.setItem(RATE_TYPE_STORAGE_KEY, rateTypeId);
    else localStorage.removeItem(RATE_TYPE_STORAGE_KEY);
    set({ rateTypeId });
  },
}));

export interface WorkspaceState {
  branches: Branch[];
  rateTypes: RateType[];
  branchId: string | null;
  rateTypeId: string | null;
  setBranchId: (branchId: string) => void;
  setRateTypeId: (rateTypeId: string) => void;
  isReady: boolean;
  isLoading: boolean;
  error: Error | null;
}

/** Active branch and selling rate shared by all operational screens. */
export function useWorkspace(): WorkspaceState {
  const selection = useWorkspaceSelection();
  const branchesQuery = useQuery({
    queryKey: ['tenant', 'branches'],
    queryFn: listBranches,
    enabled: hasTokens(),
    staleTime: 5 * 60_000,
  });
  const rateTypesQuery = useQuery({
    queryKey: ['pricing', 'rate-types'],
    queryFn: listRateTypes,
    enabled: hasTokens(),
    staleTime: 5 * 60_000,
  });

  const branches = branchesQuery.data?.data ?? [];
  const rateTypes = rateTypesQuery.data?.data ?? [];
  const branchId =
    branches.find((branch) => branch.id === selection.branchId)?.id ??
    branches.find((branch) => branch.is_default)?.id ??
    branches[0]?.id ??
    null;
  const rateTypeId =
    rateTypes.find((rateType) => rateType.id === selection.rateTypeId)?.id ??
    rateTypes.find((rateType) => rateType.is_default)?.id ??
    rateTypes[0]?.id ??
    null;

  useEffect(() => {
    if (branchId && branchId !== selection.branchId) selection.setBranchId(branchId);
  }, [branchId, selection]);
  useEffect(() => {
    if (rateTypeId && rateTypeId !== selection.rateTypeId) selection.setRateTypeId(rateTypeId);
  }, [rateTypeId, selection]);

  const queryError = branchesQuery.error ?? rateTypesQuery.error;
  return {
    branches,
    rateTypes,
    branchId,
    rateTypeId,
    setBranchId: selection.setBranchId,
    setRateTypeId: selection.setRateTypeId,
    isReady: branchId !== null && rateTypeId !== null,
    isLoading: branchesQuery.isPending || rateTypesQuery.isPending,
    error: queryError instanceof Error ? queryError : null,
  };
}
