import type { LucideIcon } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  /** Optional primary action rendered below the body. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

/** Friendly empty surface: icon chip, title, body copy, optional action. */
export function EmptyState({ icon: Icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-card px-6 py-10 text-center',
        className,
      )}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-6">
        <Icon />
      </span>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {action ? (
        <Button className="mt-2" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
