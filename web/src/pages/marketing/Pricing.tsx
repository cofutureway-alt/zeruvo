import PlansBrowser from '../user/PlansBrowser';

export default function Pricing() {
	return (
		<main className="mx-auto max-w-6xl px-6 py-12">
			<h1 className="text-2xl font-semibold tracking-tight">Pricing</h1>
			<p className="mt-1 text-sm text-[var(--nx-muted)]">
				Simple plans measured in weighted tokens. Charged in EGP via Kashier.
			</p>
			<PlansBrowser />
		</main>
	);
}
