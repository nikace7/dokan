import { Check, ChevronsUpDown, Store, Tag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useWorkspace } from '@/features/settings/useWorkspace';
import { cn } from '@/lib/utils';

/** Box chrome shared by the static chip and the popover trigger button. */
const chipClasses = cn(
  'w-full min-w-0 rounded-md border border-input bg-background px-2.5 py-1.5 text-left shadow-sm',
);

/** The two summary rows (branch over rate) inside the chip. */
const summaryClasses = cn('flex min-w-0 flex-1 flex-col gap-0.5');

const rowClasses = cn(
  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none transition-colors',
  'hover:bg-accent focus-visible:bg-accent',
);

interface OptionRowProps {
  selected: boolean;
  onSelect: () => void;
  label: string;
}

/** One selectable workspace option with a trailing check on the active one. */
function OptionRow({ selected, onSelect, label }: OptionRowProps) {
  return (
    <button type="button" aria-pressed={selected} onClick={onSelect} className={rowClasses}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {selected ? <Check className="h-4 w-4 shrink-0 text-primary" /> : null}
    </button>
  );
}

/**
 * The active branch + selling rate as one glanceable chip in the app shell.
 * Opens a popover with labeled, checkmarked choices when there is something
 * to switch; a shop with a single branch and rate gets a static readout
 * instead of two pointless dropdowns.
 */
export function WorkspaceSelector() {
  const { t } = useTranslation();
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);

  if (workspace.isLoading) {
    return <span className="text-xs text-muted-foreground">{t('settings.workspace.loading')}</span>;
  }
  if (workspace.error) {
    return (
      <span className="text-xs text-destructive">{t('settings.workspace.unavailable')}</span>
    );
  }
  if (!workspace.isReady) {
    return <span className="text-xs text-warning">{t('settings.workspace.notReady')}</span>;
  }

  const branch = workspace.branches.find((b) => b.id === workspace.branchId);
  const rateType = workspace.rateTypes.find((r) => r.id === workspace.rateTypeId);
  const canSwitchBranch = workspace.branches.length > 1;
  const canSwitchRateType = workspace.rateTypes.length > 1;
  const interactive = canSwitchBranch || canSwitchRateType;

  const summary = (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs font-semibold">{branch?.name}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2">
        <Tag className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate text-xs text-muted-foreground">{rateType?.name}</span>
      </span>
    </>
  );

  if (!interactive) {
    return <div className={cn(chipClasses, summaryClasses)}>{summary}</div>;
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('settings.workspace.switch')}
          className={cn(
            chipClasses,
            'flex items-center gap-2 transition-colors hover:bg-accent',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <span className={summaryClasses}>{summary}</span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      {/* Opens upward: the chip lives at the bottom of the shell (sidebar
          footer on desktop, More sheet on mobile). */}
      <PopoverContent side="top" align="start" className="w-64 p-2">
        {canSwitchBranch ? (
          <div role="group" aria-label={t('settings.workspace.branch')}>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
              {t('settings.workspace.branch')}
            </p>
            {workspace.branches.map((b) => (
              <OptionRow
                key={b.id}
                label={b.name}
                selected={b.id === workspace.branchId}
                onSelect={() => workspace.setBranchId(b.id)}
              />
            ))}
          </div>
        ) : null}
        {canSwitchBranch && canSwitchRateType ? <div className="mx-1 my-1 h-px bg-muted" /> : null}
        {canSwitchRateType ? (
          <div role="group" aria-label={t('settings.workspace.rateType')}>
            <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
              {t('settings.workspace.rateType')}
            </p>
            {workspace.rateTypes.map((r) => (
              <OptionRow
                key={r.id}
                label={r.name}
                selected={r.id === workspace.rateTypeId}
                onSelect={() => workspace.setRateTypeId(r.id)}
              />
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
