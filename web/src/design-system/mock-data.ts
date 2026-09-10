// Shared constants for the design system — real data comes from Supabase.
export const periods = ["7 days", "30 days", "90 days", "All time"] as const;
export type Period = (typeof periods)[number];

export const periodDays: Record<Period, number> = {
  "7 days": 7,
  "30 days": 30,
  "90 days": 90,
  "All time": 120,
};

export function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

export type UsagePoint = { date: string; weighted: number; requests: number; latency: number };
