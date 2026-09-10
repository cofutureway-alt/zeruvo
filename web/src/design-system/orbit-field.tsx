import type { CSSProperties } from "react";
import { Cpu, Database, Globe, Layers, Network, Sparkle } from "lucide-react";

const orbitIcons = [Cpu, Database, Globe, Layers, Network, Sparkle];

export function OrbitField() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
    >
      <div className="absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2">
        <div className="animate-spin-slow absolute inset-0 rounded-full border border-border/60" />
        <div
          className="animate-spin-slow absolute inset-16 rounded-full border border-border/40"
          style={{ animationDirection: "reverse", animationDuration: "22s" }}
        />
        <div
          className="animate-spin-slow absolute inset-32 rounded-full border border-border/30"
          style={{ animationDuration: "30s" }}
        />

        {orbitIcons.map((Icon, index) => {
          const radius = index % 2 === 0 ? 250 : 190;
          return (
            <div
              key={index}
              className={
                index % 2 === 0
                  ? "animate-orbit absolute left-1/2 top-1/2 -ml-4 -mt-4"
                  : "animate-orbit-reverse absolute left-1/2 top-1/2 -ml-4 -mt-4"
              }
              style={
                {
                  "--orbit-radius": `${radius}px`,
                  animationDelay: `${index * -2.4}s`,
                } as CSSProperties
              }
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card">
                <Icon className="h-4 w-4 text-primary" />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
