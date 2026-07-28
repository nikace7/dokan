import type { HTMLAttributes, ReactNode } from 'react';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
}

/** Simple surface container with an optional header row. */
export function Card({ title, actions, children, className = '', ...props }: CardProps) {
  return (
    <div
      className={['rounded-lg border border-slate-200 bg-white shadow-sm', className].join(' ')}
      {...props}
    >
      {title || actions ? (
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          {title ? <h2 className="text-base font-semibold">{title}</h2> : <span />}
          {actions}
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
}
