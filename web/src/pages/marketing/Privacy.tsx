import { useTranslation } from 'react-i18next';
import { LegalPage } from './LegalPage';

export default function Privacy() {
	const { t } = useTranslation();
	return (
		<LegalPage title={t('privacy.title')} updated="2026-08-29">
			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.collectTitle')}</h2>
				<p>{t('privacy.collectBody')}</p>
				<ul>
					<li>{t('privacy.collectItem1')}</li>
					<li>{t('privacy.collectItem2')}</li>
					<li>{t('privacy.collectItem3')}</li>
					<li>{t('privacy.collectItem4')}</li>
				</ul>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.useTitle')}</h2>
				<p>{t('privacy.useBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.sharingTitle')}</h2>
				<p>{t('privacy.sharingBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.retentionTitle')}</h2>
				<p>{t('privacy.retentionBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.rightsTitle')}</h2>
				<p>{t('privacy.rightsBody')}</p>
			</section>

			<section className="rounded-xl border border-[var(--nx-border)] bg-[var(--nx-surface)] p-5">
				<h2>{t('privacy.contactTitle')}</h2>
				<p>{t('privacy.contactBody')}</p>
			</section>
		</LegalPage>
	);
}
