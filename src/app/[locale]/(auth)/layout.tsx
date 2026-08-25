export default function AuthLayout({ children }: { children: React.ReactNode }) {
	return (
		<main className="min-h-dvh flex items-center justify-center px-4 bg-[var(--nx-bg)]">
			<div className="w-full max-w-sm">{children}</div>
		</main>
	);
}
