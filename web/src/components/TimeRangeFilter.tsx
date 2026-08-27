import type { TimeRange } from '../hooks/useModelUsage';

const RANGES: { value: TimeRange; label: string }[] = [
	{ value: '7d', label: '7 days' },
	{ value: '30d', label: '30 days' },
	{ value: '90d', label: '90 days' },
	{ value: 'all', label: 'All time' },
];

export function TimeRangeFilter(props: { value: TimeRange; onChange: (r: TimeRange) => void }) {
	return (
		<div className="flex overflow-hidden rounded-lg border border-[var(--nx-border)]">
			{RANGES.map((r) => (
				<button
					key={r.value}
					onClick={() => props.onChange(r.value)}
					className={`px-3 py-1 text-xs transition ${props.value === r.value ? 'bg-indigo-500/10 font-medium text-indigo-400' : 'text-[var(--nx-muted)] hover:text-[var(--nx-text)]'}`}
				>
					{r.label}
				</button>
			))}
		</div>
	);
}
