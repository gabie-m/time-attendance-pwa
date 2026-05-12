import type { ReactNode } from 'react';

type Tone = 'neutral' | 'success' | 'warn' | 'danger' | 'info' | 'flag' | 'sync' | 'overtime';

type PillProps = {
  tone?: Tone;
  children: ReactNode;
};

export function Pill({ tone = 'neutral', children }: PillProps) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}
