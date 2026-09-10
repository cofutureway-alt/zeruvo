import type { LucideIcon } from "lucide-react";
import { TrendingDown, TrendingUp } from "lucide-react";

import { CountUp } from "./count-up";
import { Card, CardContent } from "./card";

type StatCardProps = {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  trend?: number;
  icon?: LucideIcon;
  accent?: boolean;
};

export function StatCard({
  label,
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  trend,
  icon: Icon,
  accent,
}: StatCardProps) {
  const TrendIcon = (trend ?? 0) >= 0 ? TrendingUp : TrendingDown;

  return (
    <Card className="group relative overflow-hidden border-border bg-card transition-colors duration-300 hover:bg-accent/40">
      <span className="absolute inset-y-0 left-0 w-0.5 bg-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
      <CardContent className="flex min-h-36 flex-col justify-between p-5">
        <div className="flex items-start justify-between gap-4">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
           {Icon ? <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><Icon className="h-4 w-4 text-primary transition-colors group-hover:text-primary-foreground" aria-hidden="true" /></span> : null}
        </div>
        <CountUp
          end={value}
          prefix={prefix}
          suffix={suffix}
          decimals={decimals}
          className={`mt-2 block font-display text-3xl font-semibold tabular-nums ${
            accent ? "text-primary" : "text-foreground"
          }`}
        />
        {typeof trend === "number" ? (
          <p
            className={`mt-3 inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] font-semibold ${
              trend >= 0 ? "border-success/20 bg-success/10 text-success" : "border-destructive/20 bg-destructive/10 text-destructive"
            }`}
          >
            <TrendIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {Math.abs(trend)}% vs previous period
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
