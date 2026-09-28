'use client';

import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

/** Native disclosure: mouse, touch and keyboard work without hiding content
 * behind navigation or changing any wallet settings when opened. */
export function WalletDisclosure({
  title,
  value,
  children,
  open = false,
}: {
  title: string;
  value?: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details
      className="group border-border bg-card rounded-xl border"
      open={open || undefined}
    >
      <summary className="group-open:border-border flex cursor-pointer list-none items-center gap-3 px-5 py-4 group-open:border-b">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">{title}</h3>
        {value && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {value}
          </span>
        )}
        <ChevronDown className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      {children}
    </details>
  );
}
