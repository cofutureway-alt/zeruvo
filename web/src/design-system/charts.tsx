import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { UsagePoint } from "./mock-data";

const axisProps = {
  stroke: "var(--color-muted-foreground)",
  fontSize: 11,
  tickLine: false,
  axisLine: false,
} as const;

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: "8px",
  color: "var(--color-popover-foreground)",
  fontSize: "12px",
};

export function UsageAreaChart({ data, limit }: { data: UsagePoint[]; limit?: number }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={56} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ stroke: "var(--color-primary)" }} />
        {limit ? (
          <ReferenceLine
            y={limit}
            stroke="var(--color-muted-foreground)"
            strokeDasharray="4 4"
          />
        ) : null}
        <Area
          type="monotone"
          dataKey="weighted"
          stroke="var(--color-chart-1)"
          fill="var(--color-chart-1)"
          fillOpacity={0.18}
          strokeWidth={2}
          animationDuration={1200}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RequestsBarChart({ data }: { data: UsagePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={40} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
        <Bar
          dataKey="requests"
          fill="var(--color-chart-1)"
          radius={[4, 4, 0, 0]}
          animationDuration={1200}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function LatencyLineChart({ data }: { data: UsagePoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="date" {...axisProps} minTickGap={24} />
        <YAxis {...axisProps} width={48} unit="ms" />
        <Tooltip contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="latency"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          dot={false}
          animationDuration={1400}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

const shareColors = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-primary)",
  "var(--color-muted-foreground)",
];

export function ShareDonutChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Tooltip contentStyle={tooltipStyle} />
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
          stroke="var(--color-background)"
          animationDuration={1200}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={shareColors[index % shareColors.length]} />
          ))}
        </Pie>
      </PieChart>
    </ResponsiveContainer>
  );
}

export function RevenueBarChart({ data }: { data: { month: string; usd: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
        <XAxis dataKey="month" {...axisProps} />
        <YAxis {...axisProps} width={48} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--color-muted)" }} />
        <Bar
          dataKey="usd"
          fill="var(--color-chart-1)"
          radius={[4, 4, 0, 0]}
          animationDuration={1200}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
