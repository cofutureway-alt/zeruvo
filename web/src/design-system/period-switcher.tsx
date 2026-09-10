import { periods, type Period } from "./mock-data";
import { Button } from "./button";

type Props = {
  value: Period;
  onChange: (value: Period) => void;
};

export function PeriodSwitcher({ value, onChange }: Props) {
  return (
    <div className="inline-flex items-center rounded-md border border-border bg-background/60 p-1 shadow-sm">
      {periods.map((p) => (
        <Button
          key={p}
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onChange(p)}
          className={`h-7 rounded px-3 text-[11px] font-semibold transition-all duration-200 ${
            p === value
              ? "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {p}
        </Button>
      ))}
    </div>
  );
}
