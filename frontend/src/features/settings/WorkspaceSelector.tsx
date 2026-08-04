import { useWorkspace } from '@/features/settings/useWorkspace';

/** Compact branch/rate selector shared by the authenticated app shell. */
export function WorkspaceSelector() {
  const workspace = useWorkspace();

  if (workspace.isLoading) {
    return <span className="text-xs text-slate-300">Loading shop…</span>;
  }
  if (workspace.error) {
    return <span className="text-xs text-red-200">Shop settings unavailable</span>;
  }
  if (!workspace.isReady) {
    return <span className="text-xs text-amber-200">No active branch/rate</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <label className="sr-only" htmlFor="workspace-branch">
        Branch
      </label>
      <select
        id="workspace-branch"
        aria-label="Branch"
        value={workspace.branchId ?? ''}
        onChange={(event) => workspace.setBranchId(event.target.value)}
        className="max-w-32 rounded border border-blue-700 bg-blue-800 px-2 py-1 text-xs text-white"
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
        className="max-w-28 rounded border border-blue-700 bg-blue-800 px-2 py-1 text-xs text-white"
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
