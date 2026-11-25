import type { LucideIcon } from 'lucide-react';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { Button } from '@/components/ui/Button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** A secondary header action: a route (`to`) or something to run (`onSelect`). */
export interface HeaderAction {
  label: string;
  icon?: LucideIcon;
  to?: string;
  onSelect?: () => void;
}

/**
 * Buttons of a screen header. From `md` up all of them show; on a phone the
 * secondary ones fold into one "More" menu, so they cannot crush the title.
 * `children` is the main action, always visible.
 */
export function HeaderActions({
  actions,
  children,
}: {
  actions: HeaderAction[];
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const foldable = actions.length > 1;

  return (
    <div className="flex flex-wrap gap-2 md:justify-end">
      <div className={foldable ? 'hidden flex-wrap gap-2 md:flex' : 'contents'}>
        {actions.map(({ label, icon: Icon, to, onSelect }) =>
          to ? (
            <Button key={label} asChild variant="outline" size="sm">
              <Link to={to}>{label}</Link>
            </Button>
          ) : (
            <Button key={label} variant="outline" size="sm" onClick={onSelect}>
              {Icon ? <Icon aria-hidden="true" /> : null}
              {label}
            </Button>
          ),
        )}
      </div>
      {children}
      {foldable ? (
        // Not modal: an item may open a dialog, which takes over the page itself.
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="md:hidden">
              {t('nav.more')}
              <ChevronDown aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="md:hidden">
            {actions.map(({ label, icon: Icon, to, onSelect }) =>
              to ? (
                <DropdownMenuItem key={label} asChild>
                  <Link to={to}>{label}</Link>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={label} onSelect={onSelect}>
                  {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
                  {label}
                </DropdownMenuItem>
              ),
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
