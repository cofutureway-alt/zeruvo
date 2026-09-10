import type { ReactNode } from "react";

type MarqueeProps = {
  items: ReactNode[];
  className?: string;
};

export function Marquee({ items, className }: MarqueeProps) {
  return (
    <div
      className={`group relative flex overflow-hidden ${className ?? ""}`}
      role="presentation"
    >
      <div className="animate-marquee flex min-w-full shrink-0 items-center gap-16 pr-16 group-hover:[animation-play-state:paused]">
        {[...items, ...items].map((item, index) => (
          <div key={index} className="shrink-0">
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}
