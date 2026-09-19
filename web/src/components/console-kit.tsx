// Console kit — shared primitives for the dark "data console" redesign.
// Mono numerals (JetBrains Mono), cyan/teal accents, bordered cards,
// status pills. Used by user + admin dashboards and the models catalog.
import type { ReactNode } from 'react';

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-console-display text-2xl font-semibold tracking-tight text-foreground">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const pillTones = {
  green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
  red: 'border-red-500/40 bg-red-500/10 text-red-400',
  amber: 'border-amber-500/40 bg-amber-500/10 text-amber-400',
  teal: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400',
  gray: 'border-border bg-muted/40 text-muted-foreground',
  violet: 'border-violet-500/40 bg-violet-500/10 text-violet-400',
} as const;

export type PillTone = keyof typeof pillTones;

export function Pill({ tone = 'gray', children, className = '' }: { tone?: PillTone; children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-4 ${pillTones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ConsoleCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-[var(--nx-surface)] ${className}`}>{children}</div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = 'teal',
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  tone?: PillTone;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-[var(--nx-surface)] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        {icon && <span className={`grid size-8 place-items-center rounded-lg border ${pillTones[tone]}`}>{icon}</span>}
      </div>
      <p className="mt-2 font-data text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

export function EmptyState({ icon, title, hint }: { icon?: ReactNode; title: ReactNode; hint?: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-xl border border-dashed border-border px-6 py-14 text-center">
      {icon && <div className="mb-3 text-muted-foreground/60">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {hint && <p className="mt-1 max-w-sm text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** "$0.158" style mono amounts */
export function Money({ value, suffix, className = '' }: { value: string | number | null | undefined; suffix?: string; className?: string }) {
  if (value == null) return <span className={`font-data text-muted-foreground ${className}`}>—</span>;
  return (
    <span className={`font-data tabular-nums ${className}`}>
      ${typeof value === 'number' ? Number(value).toFixed(value < 1 ? 3 : 2) : value}
      {suffix}
    </span>
  );
}

/** 128K / 1.05M compact token counts */
export function compactTokens(n: number | null | undefined): string {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 2)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return String(n);
}

export function Toggle({
  checked,
  onChange,
  disabled,
  labels,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  labels: [string, string];
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group inline-flex items-center gap-2 disabled:opacity-50"
    >
      <span
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors ${
          checked ? 'border-cyan-500/60 bg-cyan-500/20' : 'border-border bg-muted/50'
        }`}
      >
        <span
          className={`absolute size-4 rounded-full transition-all ${
            checked ? 'ltr:left-[26px] rtl:right-[26px] bg-cyan-400' : 'ltr:left-[4px] rtl:right-[4px] bg-muted-foreground'
          }`}
        />
      </span>
      <span className={`text-xs font-medium ${checked ? 'text-cyan-400' : 'text-muted-foreground'}`}>
        {checked ? labels[1] : labels[0]}
      </span>
    </button>
  );
}
