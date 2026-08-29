import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';
import { LegalPage } from './LegalPage';

export default function Refund() {
	const { t } = useTranslation();
	return (
		<LegalPage title={t('refund.title')} updated="2026-08-29">
			{/* the hard rule — first thing on the page */}
			<div className="flex items-start gap-3 rounded-xl border border-red-500/40 bg-red-500/10 p-5">
				<AlertTriangle size={20} className="mt-0.5 shrink-0 text-red-400" />
				<div>
					<p className="font-semibold text-red-300">{t('refund.noRefundsTitle')}</p>
					<p className="mt-1 text-red-200/90">{t('refund.noRefundsBody')}</p>
				</div>
			</div>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('refund.scopeTitle')}</h2>
				<p>{t('refund.scopeBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('refund.billingTitle')}</h2>
				<p>{t('refund.billingBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('refund.cancelTitle')}</h2>
				<p>{t('refund.cancelBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('refund.chargesTitle')}</h2>
				<p>{t('refund.chargesBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('refund.contactTitle')}</h2>
				<p>{t('refund.contactBody')}</p>
			</section>
		</LegalPage>
	);
}
