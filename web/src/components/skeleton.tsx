import { type ReactNode } from 'react';

/** Shimmer base — a soft sweep across placeholder blocks. */
export function Skeleton({ className = '' }: { className?: string }) {
	return <div className={`nx-skeleton ${className}`} aria-hidden />;
}

/** Card-shaped skeleton matching SpotlightCard proportions. */
export function SkeletonCard() {
	return (
		<div className="spotlight-card p-7">
			<Skeleton className="h-3 w-40" />
			<Skeleton className="mt-4 h-5 w-2/3" />
			<Skeleton className="mt-3 h-3 w-full" />
			<Skeleton className="mt-2 h-3 w-5/6" />
		</div>
	);
}

/** Model-grid skeleton: N card shells with title/multiplier/meta rows. */
export function SkeletonModelGrid({ count = 9 }: { count?: number }) {
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading models">
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-4">
					<div className="flex items-center justify-between gap-2">
						<Skeleton className="h-4 w-36" />
						<Skeleton className="h-5 w-10 rounded-md" />
					</div>
					<Skeleton className="mt-1.5 h-3 w-44" />
					<Skeleton className="mt-4 h-2.5 w-24" />
				</div>
			))}
		</div>
	);
}

/** Table skeleton for logs/payments/users lists. */
export function SkeletonTable({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
	return (
		<div className="overflow-hidden rounded-xl border border-[var(--nx-border)]" aria-busy="true">
			<div className="flex gap-4 border-b border-[var(--nx-border)] bg-zinc-900/60 px-4 py-3">
				{Array.from({ length: cols }).map((_, i) => (
					<Skeleton key={i} className="h-3 flex-1" />
				))}
			</div>
			{Array.from({ length: rows }).map((_, r) => (
				<div key={r} className="flex gap-4 border-b border-[var(--nx-border)] px-4 py-3.5 last:border-0">
					{Array.from({ length: cols }).map((_, c) => (
						<Skeleton key={c} className={`h-3.5 flex-1 ${c === 0 ? 'max-w-32' : ''}`} />
					))}
				</div>
			))}
		</div>
	);
}

/** Dashboard stat-card skeleton trio. */
export function SkeletonStats() {
	return (
		<div className="grid gap-4 sm:grid-cols-3" aria-busy="true">
			{Array.from({ length: 3 }).map((_, i) => (
				<div key={i} className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<Skeleton className="h-3 w-20" />
					<Skeleton className="mt-3 h-6 w-28" />
				</div>
			))}
		</div>
	);
}

/** Pricing plan card skeleton. */
export function SkeletonPlans({ count = 3 }: { count?: number }) {
	return (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-busy="true">
			{Array.from({ length: count }).map((_, i) => (
				<div key={i} className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
					<Skeleton className="h-4 w-24" />
					<Skeleton className="mt-3 h-8 w-32" />
					<Skeleton className="mt-4 h-3 w-40" />
					<Skeleton className="mt-5 h-9 w-full rounded-lg" />
				</div>
			))}
		</div>
	);
}

/** Full-page skeleton for detail views. */
export function SkeletonDetail() {
	return (
		<div aria-busy="true">
			<Skeleton className="h-3 w-20" />
			<Skeleton className="mt-5 h-8 w-72" />
			<Skeleton className="mt-2 h-3 w-48" />
			<Skeleton className="mt-7 h-3 w-full max-w-xl" />
			<Skeleton className="mt-2 h-3 w-full max-w-md" />
			<div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
				{Array.from({ length: 4 }).map((_, i) => (
					<div key={i} className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-3.5">
						<Skeleton className="h-2.5 w-16" />
						<Skeleton className="mt-2.5 h-4 w-20" />
					</div>
				))}
			</div>
			<Skeleton className="mt-10 h-40 w-full rounded-xl" />
		</div>
	);
}

export function WithSkeleton({ loading, skeleton, children }: { loading: boolean; skeleton: ReactNode; children: ReactNode }) {
	return <>{loading ? skeleton : children}</>;
}
