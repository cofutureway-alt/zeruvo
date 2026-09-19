import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, BadgePercent, Layers, Wallet, Repeat } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { useAuth } from '../../auth-context';
import { VendorMark, vendorLabel } from '../../design-system/vendor-marks';
import { Toggle, compactTokens } from '../../components/console-kit';
import type { ModelCardData } from '../../components/ModelCard';

type ModelFull = ModelCardData & {
  description: string | null;
  upstream_model_id: string;
  tags: string[] | null;
  cache_read_price: number | string | null;
  cache_write_price: number | string | null;
  supports_effort: boolean;
  max_output_tokens: number | null;
  requests_30d: number | null;
};

/** Model detail — full metadata, pricing, and the plan↔PAYG billing toggle. */
export default function ModelDetail() {
  const { t, i18n } = useTranslation();
  const { slug } = useParams<{ slug: string }>();
  const { session, isAdmin } = useAuth();
  const [model, setModel] = useState<ModelFull | null>(null);
  const [loading, setLoading] = useState(true);
  const [pref, setPref] = useState<'plan_first' | 'wallet_first' | null>(null);
  const [savingPref, setSavingPref] = useState(false);
  const ar = i18n.language === 'ar';

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('models_public_view')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      const row = data as unknown as ModelFull | null;
      // non-priced models stay admin-only
      setModel(row && (row.is_priced || isAdmin) ? row : null);
      setLoading(false);
      if (row) document.title = `${row.display_name} · Zeruvo AI`;
    })();
  }, [slug, isAdmin]);

  // billing preference for the toggle
  useEffect(() => {
    if (!session) return;
    void supabase
      .from('profiles')
      .select('billing_preference')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setPref((data?.billing_preference as 'plan_first' | 'wallet_first') ?? 'plan_first'));
  }, [session]);

  async function switchPref(next: 'plan_first' | 'wallet_first') {
    if (!session || savingPref) return;
    setSavingPref(true);
    setPref(next);
    await supabase.from('profiles').update({ billing_preference: next }).eq('id', session.user.id);
    setSavingPref(false);
  }

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <NewSiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
          <div className="h-8 w-56 animate-pulse rounded bg-muted" />
          <div className="mt-6 h-24 animate-pulse rounded bg-muted" />
        </main>
      </div>
    );
  }
  if (!model) {
    return (
      <div className="flex min-h-screen flex-col bg-background text-foreground">
        <NewSiteHeader />
        <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-24 text-center">
          <h1 className="font-display text-xl font-semibold">{ar ? 'الموديل غير موجود' : 'Model not found'}</h1>
          <Link to="/models" className="mt-4 inline-block text-sm text-primary">← {ar ? 'كل الموديلات' : 'All models'}</Link>
        </main>
        <NewSiteFooter />
      </div>
    );
  }

  const mult = Number(model.usage_multiplier);
  const discount = Number(model.discount_percent ?? 0);
  const paygLive = model.payg_enabled && (model.input_price != null || model.output_price != null);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NewSiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12">
        <Link to="/models" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft size={13} className="rtl:rotate-180" />
          {ar ? 'كل الموديلات' : 'All models'}
        </Link>

        <Reveal>
          <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <span className="grid size-14 place-items-center rounded-2xl border border-border bg-[var(--console-elevated)] p-2.5 text-cyan-400">
                <VendorMark slug={model.vendor_slug} className="size-full" />
              </span>
              <div>
                <h1 className="font-console-display text-2xl font-semibold tracking-tight">{model.display_name}</h1>
                <p className="mt-0.5 text-sm text-muted-foreground">{model.vendor_name || vendorLabel(model.vendor_slug)}</p>
                <p className="mt-1 font-data text-xs text-muted-foreground/70">{model.upstream_model_id}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              {model.enabled_for_users && (model.is_priced || isAdmin) ? (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/50 px-2.5 py-1.5 text-xs font-semibold text-cyan-400">
                  <CheckCircle2 size={13} /> {ar ? 'متاح' : 'Available'}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 px-2.5 py-1.5 text-xs font-semibold text-red-400">
                  {ar ? 'غير مسعّر' : 'Unpriced'}
                </span>
              )}
              {discount > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/60 px-2.5 py-1.5 text-xs font-semibold text-amber-400">
                  <BadgePercent size={13} /> {Math.round(discount)}% off
                </span>
              )}
            </div>
          </header>

          <p className="mt-6 leading-relaxed text-muted-foreground">
            {model.description ??
              (ar
                ? `${model.display_name} يعمل عبر بوابة Zeruvo.`
                : `${model.display_name} is served through the Zeruvo gateway.`)}
          </p>
        </Reveal>

        {/* pricing */}
        <Reveal delay={80}>
          <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Spec label={ar ? 'الإدخال / 1M' : 'Input / 1M'} value={model.input_price != null ? `$${Number(model.input_price).toFixed(Number(model.input_price) < 1 ? 3 : 2)}` : '—'} mono strike={discount > 0 && !!model.input_price} />
            <Spec label={ar ? 'الإخراج / 1M' : 'Output / 1M'} value={model.output_price != null ? `$${Number(model.output_price).toFixed(Number(model.output_price) < 1 ? 3 : 2)}` : '—'} mono strike={discount > 0 && !!model.output_price} />
            <Spec label={ar ? 'الكاش / 1M' : 'Cache / 1M'} value={model.cache_read_price != null ? `$${Number(model.cache_read_price).toFixed(Number(model.cache_read_price) < 1 ? 3 : 2)}` : '—'} mono />
            <Spec label={ar ? 'السياق' : 'Context'} value={model.context_window ? compactTokens(model.context_window) : '—'} mono />
          </section>
        </Reveal>

        {/* capabilities */}
        <Reveal delay={120}>
          <section className="mt-4 flex flex-wrap items-center gap-2">
            {model.supports_reasoning && <Cap label={ar ? 'تفكير عميق' : 'Reasoning'} tone="violet" />}
            {model.supports_effort && <Cap label={ar ? 'جهد قابل للضبط' : 'Effort control'} tone="violet" />}
            {(model.input_modalities ?? []).includes('image') && <Cap label={ar ? 'إدخال صور' : 'Image input'} tone="teal" />}
            {(model.output_modalities ?? []).includes('image') && <Cap label={ar ? 'توليد صور' : 'Image generation'} tone="teal" />}
            {(model.input_modalities ?? []).includes('audio') && <Cap label={ar ? 'صوت' : 'Audio'} tone="teal" />}
            {(model.input_modalities ?? []).includes('video') && <Cap label={ar ? 'فيديو' : 'Video'} tone="teal" />}
            {(model.tags ?? []).includes('coding') && <Cap label={ar ? 'برمجة' : 'Coding'} tone="green" />}
            {model.max_output_tokens && <Cap label={`${ar ? 'أقصى إخراج' : 'Max out'} ${compactTokens(model.max_output_tokens)}`} tone="gray" />}
          </section>
        </Reveal>

        {/* stats + billing mode */}
        <Reveal delay={160}>
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-border bg-[var(--nx-surface)] p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{ar ? 'الاستخدام' : 'Usage'}</h3>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 font-data text-sm text-cyan-300/90">
                <span className="inline-flex items-center gap-1.5"><Layers size={14} /> {model.context_window ? compactTokens(model.context_window) : '—'}</span>
                <span className="inline-flex items-center gap-1.5">{model.requests_30d ?? 0} {ar ? 'طلب / 30 يوم' : 'requests / 30d'}</span>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {ar ? 'خطة التوكنز المرجّحة' : 'Weighted-token plan'}: <span className="font-data text-foreground">×{mult}</span>
                {mult === 0 && (ar ? ' (مجاني على الخطط)' : ' (free on plans)')}
              </p>
            </div>

            {session && (
              <div className="rounded-xl border border-border bg-[var(--nx-surface)] p-4">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <Repeat size={13} /> {ar ? 'وضع الفوترة المفضل' : 'Preferred billing mode'}
                </h3>
                <div className="mt-3">
                  <Toggle
                    checked={pref === 'wallet_first'}
                    onChange={(v) => switchPref(v ? 'wallet_first' : 'plan_first')}
                    disabled={savingPref || !paygLive}
                    labels={ar ? ['استهلاك الخطة', 'الدفع للاستخدام'] : ['Use plan quota', 'Pay-As-You-Go']}
                  />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {ar
                    ? 'بدّل بين استهلاك خطة التوكنز المرجّحة والدفع لكل مليون توكن من محفظتك. يُطبَّق على كل موديل يدعم الوضعين.'
                    : 'Switch between your weighted-token plan allowance and per-1M-token Pay-As-You-Go from your wallet. Applies to every model supporting both.'}
                </p>
                <Link to="/dashboard/wallet" className="mt-2 inline-flex items-center gap-1.5 text-xs text-cyan-400 hover:text-cyan-300">
                  <Wallet size={13} /> {ar ? 'إدارة المحفظة' : 'Manage wallet'}
                </Link>
              </div>
            )}
          </div>
        </Reveal>

        {/* quickstart */}
        <Reveal delay={200}>
          <section className="mt-10 overflow-hidden rounded-lg border border-border bg-card transition-colors duration-300 hover:border-primary/50">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className="h-3 w-3 rounded-full bg-primary/30" />
              <div className="h-3 w-3 rounded-full bg-primary/30" />
              <div className="h-3 w-3 rounded-full bg-primary/30" />
              <span className="ml-2 text-xs text-muted-foreground">quickstart.sh</span>
            </div>
            <pre dir="ltr" className="overflow-x-auto p-4 font-mono text-xs leading-relaxed text-muted-foreground">
{`curl ${import.meta.env.VITE_GATEWAY_URL ?? 'https://api.zeruvo.online'}/v1/chat/completions \\
  -H "Authorization: Bearer $ZERUVO_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "${model.upstream_model_id}",
    "messages": [{"role": "user", "content": "Hello"}]
  }'`}
            </pre>
          </section>
        </Reveal>

        {!session && (
          <Link
            to="/signup"
            className="mt-8 inline-flex items-center rounded-md bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-all duration-300 hover:-translate-y-0.5 hover:bg-primary/90"
          >
            {ar ? 'ابدأ باستخدام هذا الموديل مجانًا' : 'Start using this model free'}
          </Link>
        )}
      </main>
      <NewSiteFooter legal={[
        { to: '/privacy', label: ar ? 'سياسة الخصوصية' : 'Privacy' },
        { to: '/refund', label: ar ? 'سياسة الاسترجاع' : 'Refund policy' },
      ]} />
    </div>
  );
}

function Spec({ label, value, mono, strike }: { label: string; value: string; mono?: boolean; strike?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3.5">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 truncate text-sm font-medium ${mono ? 'font-data tabular-nums' : ''} ${strike ? 'line-through decoration-amber-500/70' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Cap({ label, tone }: { label: string; tone: 'teal' | 'violet' | 'green' | 'gray' }) {
  const tones = {
    teal: 'border-cyan-500/40 bg-cyan-500/10 text-cyan-300',
    violet: 'border-violet-500/40 bg-violet-500/10 text-violet-300',
    green: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
    gray: 'border-border bg-muted/30 text-muted-foreground',
  };
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tones[tone]}`}>{label}</span>;
}
