const INPUTS = [60, 140, 220, 300, 380, 460];
const HIDDEN_A = [80, 170, 260, 350, 440];
const HIDDEN_B = [90, 190, 290, 390];
const HIDDEN_C = [80, 170, 260, 350, 440];
const OUTPUTS = [70, 150, 230, 310, 390, 470];

const COLS = [
  { x: 70, ys: INPUTS, r: 7, node: "fill-primary" },
  { x: 220, ys: HIDDEN_A, r: 10, node: "fill-primary/90" },
  { x: 380, ys: HIDDEN_B, r: 11, node: "fill-primary" },
  { x: 540, ys: HIDDEN_C, r: 10, node: "fill-primary/90" },
  { x: 690, ys: OUTPUTS, r: 7, node: "fill-primary" },
];

const LINKS: { x1: number; y1: number; x2: number; y2: number }[] = [];
for (let c = 0; c < COLS.length - 1; c++) {
  const from = COLS[c]!;
  const to = COLS[c + 1]!;
  for (const y1 of from.ys) {
    for (const y2 of to.ys) {
      LINKS.push({ x1: from.x, y1, x2: to.x, y2 });
    }
  }
}

const PULSES = [0, 7, 15, 23, 31, 40];

export function NetworkField() {
  return (
    <div className="relative w-full max-w-lg">
      <div className="animate-pulse-ring absolute inset-6 rounded-3xl border border-primary/40" aria-hidden="true" />
      <div className="animate-float relative overflow-hidden rounded-3xl border border-border bg-card shadow-xl">
        <svg
          viewBox="0 0 760 520"
          role="img"
          aria-label="Animated neural network routing requests across model layers"
          className="h-auto w-full text-primary"
        >
          <g className="stroke-primary/25" strokeWidth={1}>
            {LINKS.map((l, i) => (
              <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
            ))}
          </g>
          <g className="stroke-primary/70" strokeWidth={1.5} strokeDasharray="6 18">
            {LINKS.filter((_, i) => i % 5 === 0).map((l, i) => (
              <line
                key={i}
                x1={l.x1}
                y1={l.y1}
                x2={l.x2}
                y2={l.y2}
                className="animate-dash"
                style={{ animationDelay: `${(i % 6) * 0.2}s` }}
              />
            ))}
          </g>
          <g className="fill-primary">
            {PULSES.map((linkIndex, i) => {
              const l = LINKS[linkIndex % LINKS.length]!;
              return (
                <circle key={i} r={4}>
                  <animateMotion
                    dur={`${2.4 + (i % 3) * 0.6}s`}
                    begin={`${i * 0.4}s`}
                    repeatCount="indefinite"
                    path={`M ${l.x1} ${l.y1} L ${l.x2} ${l.y2}`}
                  />
                </circle>
              );
            })}
          </g>
          {COLS.map((col, ci) => (
            <g key={ci}>
              {col.ys.map((y, ni) => (
                <g key={ni}>
                  <circle
                    cx={col.x}
                    cy={y}
                    r={col.r + 6}
                    className="fill-primary/15"
                  >
                    <animate
                      attributeName="r"
                      values={`${col.r + 4};${col.r + 10};${col.r + 4}`}
                      dur={`${2.5 + ((ci + ni) % 4) * 0.7}s`}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.9;0.2;0.9"
                      dur={`${2.5 + ((ci + ni) % 4) * 0.7}s`}
                      repeatCount="indefinite"
                    />
                  </circle>
                  <circle cx={col.x} cy={y} r={col.r} className={col.node} />
                </g>
              ))}
            </g>
          ))}
        </svg>
        <div className="flex items-center justify-between border-t border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="font-display font-medium tracking-wide text-foreground">
            Live routing mesh
          </span>
          <span className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            3 protocols · global mesh
          </span>
        </div>
      </div>
    </div>
  );
}
