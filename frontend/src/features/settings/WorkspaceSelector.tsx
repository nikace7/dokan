import { useWorkspace } from '@/features/settings/useWorkspace';
import { cn } from '@/lib/utils';

const selectClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground',
  'focus:outline-none focus:ring-2 focus:ring-ring',
);

/** Compact branch/rate selector shared by the authenticated app shell. */
export function WorkspaceSelector() {
  const workspace = useWorkspace();

  if (workspace.isLoading) {
    return <span className="text-xs text-muted-foreground">Loading shop…</span>;
  }
  if (workspace.error) {
    return <span className="text-xs text-destructive">Shop settings unavailable</span>;
  }
  if (!workspace.isReady) {
    return <span className="text-xs text-warning">No active branch/rate</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="workspace-branch">
        Branch
      </label>
      <select
        id="workspace-branch"
        aria-label="Branch"
        value={workspace.branchId ?? ''}
        onChange={(event) => workspace.setBranchId(event.target.value)}
        className={selectClasses}
      >
        {workspace.branches.map((branch) => (
          <option key={branch.id} value={branch.id}>
            {branch.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="workspace-rate-type">
        Rate type
      </label>
      <select
        id="workspace-rate-type"
        aria-label="Rate type"
        value={workspace.rateTypeId ?? ''}
        onChange={(event) => workspace.setRateTypeId(event.target.value)}
        className={selectClasses}
      >
        {workspace.rateTypes.map((rateType) => (
          <option key={rateType.id} value={rateType.id}>
            {rateType.name}
          </option>
        ))}
      </select>
    </div>
  );
}
