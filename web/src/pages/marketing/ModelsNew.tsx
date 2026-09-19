import { useEffect, useMemo, useState } from 'react';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { supabase } from '../../lib/supabase';
import { NewSiteHeader, NewSiteFooter } from '../../design-system/new-chrome';
import { Reveal } from '../../design-system/reveal';
import { useAuth } from '../../auth-context';
import { ModelCard, type ModelCardData } from '../../components/ModelCard';
import { VENDOR_META, vendorLabel } from '../../design-system/vendor-marks';
import { SkeletonTable } from '../../components/skeleton';

/**
 * Public model catalog — dark data-console card grid with advanced
 * filtering (vendor, modality, context window, price band, capability
 * tags) + Promotional/Recommended groups. Unpriced models are visible
 * to admins only (red badge).
 */
type ModelRow = ModelCardData & {
  description: string | null;
  tags: string[] | null;
  upstream_model_id: string;
  cache_read_price: number | string | null;
  cache_write_price: number | string | null;
  supports_effort: boolean;
  max_output_tokens: number | null;
  requests_30d: number | null;
};

const CAPABILITIES = [
  { key: 'coding', ar: 'برمجة', en: 'Coding' },
  { key: 'vision', ar: 'رؤية', en: 'Vision' },
  { key: 'reasoning', ar: 'تفكير عميق', en: 'Reasoning' },
  { key: 'image-output', ar: 'توليد صور', en: 'Image output' },
  { key: 'audio', ar: 'صوت', en: 'Audio' },
  { key: 'video', ar: 'فيديو', en: 'Video' },
] as const;

const CONTEXT_BANDS = [
  { key: 'any', ar: 'الكل', en: 'Any', test: () => true },
  { key: 's', ar: '< 32K', en: '< 32K', test: (n: number) => n < 32_000 },
  { key: 'm', ar: '32K – 128K', en: '32K – 128K', test: (n: number) => n >= 32_000 && n < 128_000 },
  { key: 'l', ar: '128K – 512K', en: '128K – 512K', test: (n: number) => n >= 128_000 && n < 512_000 },
  { key: 'xl', ar: '> 512K', en: '> 512K', test: (n: number) => n >= 512_000 },
] as const;

const PAGE_SIZE = 100;

const PRICE_BANDS = [
  { key: 'any', ar: 'الكل', en: 'Any', test: () => true },
  { key: 'low', ar: '< $1', en: '< $1', test: (n: number) => n < 1 },
  { key: 'mid', ar: '$1 – $5', en: '$1 – $5', test: (n: number) => n >= 1 && n < 5 },
  { key: 'high', ar: '> $5', en: '> $5', test: (n: number) => n >= 5 },
] as const;

function modalityMatch(row: ModelRow, cap: string): boolean {
  if (cap === 'audio' || cap === 'video') {
    return (row.input_modalities ?? []).includes(cap) || (row.output_modalities ?? []).includes(cap);
  }
  if (cap === 'vision') return (row.input_modalities ?? []).includes('image') || (row.tags ?? []).includes('vision');
  if (cap === 'image-output') return (row.output_modalities ?? []).includes('image') || (row.tags ?? []).includes('image-output');
  if (cap === 'reasoning') return !!row.supports_reasoning || (row.tags ?? []).includes('reasoning');
  if (cap === 'coding') return (row.tags ?? []).includes('coding');
  return false;
}

function blended(row: ModelRow): number | null {
  const i = row.input_price != null ? Number(row.input_price) : null;
  const o = row.output_price != null ? Number(row.output_price) : null;
  if (i == null && o == null) return null;
  if (i == null) return o!;
  if (o == null) return i;
  return (3 * i + o) / 4;
}

export default function Models() {
  const { t, i18n } = useTranslation();
  const { isAdmin } = useAuth();
  const [models, setModels] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [query, setQuery] = useState('');
  const [vendor, setVendor] = useState('any');
  const [cap, setCap] = useState<string | null>(null);
  const [band, setBand] = useState('any');
  const [priceBand, setPriceBand] = useState('any');
  const [sort, setSort] = useState<'name' | 'price_asc' | 'price_desc' | 'context'>('name');
  const [showFilters, setShowFilters] = useState(true);
  const [page, setPage] = useState(1);

  useEffect(() => {
    void (async () => {
      // models_public_view: vendor info + effective (post-discount) prices
      // + is_priced + live throughput stats
      const { data } = await supabase
        .from('models_public_view')
        .select('*')
        .eq('enabled_for_users', true)
        .order('display_name');
      setModels((data ?? []) as unknown as ModelRow[]);
      setLoading(false);
    })();
  }, []);

  const vendors = useMemo(() => {
    const present = [...new Set(models.map((m) => m.vendor_slug ?? 'other'))];
    return present.sort((a, b) => (VENDOR_META[a]?.label ?? a).localeCompare(VENDOR_META[b]?.label ?? b));
  }, [models]);

  const visible = useMemo(() => {
    // unpriced models are an admin-only view
    const base = models.filter((m) => m.is_priced || isAdmin);
    return base.filter((m) => {
      const q = query.trim().toLowerCase();
      if (q && !m.display_name.toLowerCase().includes(q) && !m.upstream_model_id.toLowerCase().includes(q)) return false;
      if (vendor !== 'any' && (m.vendor_slug ?? 'other') !== vendor) return false;
      if (cap && !modalityMatch(m, cap)) return false;
      if (band !== 'any') {
        const b = CONTEXT_BANDS.find((x) => x.key === band)!;
        if (!m.context_window || !b.test(m.context_window)) return false;
      }
      if (priceBand !== 'any') {
        const p = blended(m);
        const pb = PRICE_BANDS.find((x) => x.key === priceBand)!;
        if (p == null || !pb.test(p)) return false;
      }
      return true;
    });
  }, [models, query, vendor, cap, band, priceBand, isAdmin]);

  const sorted = useMemo(() => {
    const list = [...visible];
    list.sort((a, b) => {
      if (sort === 'price_asc' || sort === 'price_desc') {
        const pa = blended(a), pb = blended(b);
        if (pa == null && pb == null) return a.display_name.localeCompare(b.display_name);
        if (pa == null) return 1;
        if (pb == null) return -1;
        return sort === 'price_asc' ? pa - pb : pb - pa;
      }
      if (sort === 'context') return (b.context_window ?? 0) - (a.context_window ?? 0);
      return a.display_name.localeCompare(b.display_name);
    });
    return list;
  }, [visible, sort]);

  // 100 models per page, reset when any filter changes
  useEffect(() => {
    setPage(1);
  }, [query, vendor, cap, band, priceBand, sort]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sorted, safePage],
  );

  const promotional = pageRows.filter((m) => Number(m.discount_percent ?? 0) > 0);
  const recommended = pageRows.filter((m) => m.is_featured && Number(m.discount_percent ?? 0) === 0);
  const rest = pageRows.filter((m) => !promotional.includes(m) && !recommended.includes(m));
  const grouped = promotional.length > 0 || recommended.length > 0;

  const ar = i18n.language === 'ar';
  const activeFilters = (vendor !== 'any' ? 1 : 0) + (cap ? 1 : 0) + (band !== 'any' ? 1 : 0) + (priceBand !== 'any' ? 1 : 0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <NewSiteHeader />
      <main className="flex-1 px-4 py-12 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-console-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  {ar ? 'الموديلات' : 'Models'}
                </h1>
                <p className="mt-2 max-w-xl text-muted-foreground">
                  {ar
                    ? 'كل موديل متاح عبر بوابة Zeruvo — أسعار الدفع لكل مليون توكن، نافذة السياق، والقدرات.'
                    : 'Every model on the Zeruvo gateway — per-1M-token pricing, context windows and capabilities.'}
                </p>
              </div>
              <p className="font-data text-sm text-muted-foreground">
                {loading ? '…' : `${sorted.length} / ${models.filter((m) => m.is_priced || isAdmin).length}`}
              </p>
            </div>
          </Reveal>

          {/* toolbar */}
          <div className="sticky top-2 z-20 mt-8 rounded-xl border border-border bg-background/85 p-3 backdrop-blur-xl">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-52 flex-1">
                <Search size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={ar ? 'ابحث عن موديل أو مزود…' : 'Search models, providers…'}
                  className="w-full rounded-lg border border-border bg-transparent py-2 pe-3 ps-9 text-sm outline-none focus:border-cyan-500"
                />
              </label>
              <select
                value={vendor}
                onChange={(e) => setVendor(e.target.value)}
                className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500"
              >
                <option value="any">{ar ? 'كل المزودين' : 'All providers'}</option>
                {vendors.map((v) => (
                  <option key={v} value={v}>{vendorLabel(v)}</option>
                ))}
              </select>
              <select
                value={band}
                onChange={(e) => setBand(e.target.value)}
                className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500"
              >
                {CONTEXT_BANDS.map((b) => (
                  <option key={b.key} value={b.key}>{b.key === 'any' ? (ar ? 'الكونتكست: الكل' : 'Context') : b.en}</option>
                ))}
              </select>
              <select
                value={priceBand}
                onChange={(e) => setPriceBand(e.target.value)}
                className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500"
              >
                {PRICE_BANDS.map((b) => (
                  <option key={b.key} value={b.key}>{b.key === 'any' ? (ar ? 'السعر: الكل' : 'Price') : b.en}</option>
                ))}
              </select>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as typeof sort)}
                className="h-9 rounded-lg border border-border bg-transparent px-3 text-sm outline-none focus:border-cyan-500"
              >
                <option value="name">{ar ? 'ترتيب: الاسم' : 'Name'}</option>
                <option value="price_asc">{ar ? 'السعر ↑' : 'Price ↑'}</option>
                <option value="price_desc">{ar ? 'السعر ↓' : 'Price ↓'}</option>
                <option value="context">{ar ? 'الكونتكست' : 'Context'}</option>
              </select>
              <button
                onClick={() => setShowFilters((s) => !s)}
                className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-sm ${
                  activeFilters ? 'border-cyan-500/60 text-cyan-400' : 'border-border text-muted-foreground'
                }`}
              >
                <SlidersHorizontal size={14} />
                {ar ? 'قدرات' : 'Filters'}
                {activeFilters > 0 && <span className="font-data">·{activeFilters}</span>}
              </button>
            </div>
            {showFilters && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {CAPABILITIES.map((c) => (
                  <button
                    key={c.key}
                    onClick={() => setCap((v) => (v === c.key ? null : c.key))}
                    className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                      cap === c.key
                        ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300'
                        : 'border-border text-muted-foreground hover:border-cyan-500/40'
                    }`}
                  >
                    {ar ? c.ar : c.en}
                  </button>
                ))}
                {activeFilters > 0 && (
                  <button
                    onClick={() => { setVendor('any'); setCap(null); setBand('any'); setPriceBand('any'); }}
                    className="ms-1 inline-flex items-center gap-1 rounded-full border border-red-500/40 px-3 py-1 text-xs text-red-400"
                  >
                    <X size={12} /> {ar ? 'مسح الفلاتر' : 'Clear'}
                  </button>
                )}
              </div>
            )}
          </div>

          {/* grid */}
          <div className="mt-8 space-y-10">
            {loading ? (
              <SkeletonTable rows={6} />
            ) : sorted.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-6 py-16 text-center text-sm text-muted-foreground">
                {ar ? 'لا توجد موديلات مطابقة للفلاتر.' : 'No models match the current filters.'}
              </div>
            ) : (
              <>
                {grouped && promotional.length > 0 && (
                  <section>
                    <h2 className="mb-4 flex items-center gap-2 font-data text-xs font-semibold uppercase tracking-[0.2em] text-amber-400">
                      {ar ? 'عروض ترويجية' : 'Promotional'}
                      <span className="font-data text-muted-foreground">{promotional.length}</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {promotional.map((m) => <ModelCard key={m.id} model={m} showAdminBadges={!!isAdmin} />)}
                    </div>
                  </section>
                )}
                {grouped && recommended.length > 0 && (
                  <section>
                    <h2 className="mb-4 flex items-center gap-2 font-data text-xs font-semibold uppercase tracking-[0.2em] text-violet-400">
                      {ar ? 'موصى به' : 'Recommended'}
                      <span className="font-data text-muted-foreground">{recommended.length}</span>
                    </h2>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {recommended.map((m) => <ModelCard key={m.id} model={m} showAdminBadges={!!isAdmin} />)}
                    </div>
                  </section>
                )}
                {(!grouped || rest.length > 0) && (
                  <section>
                    {grouped && (
                      <h2 className="mb-4 flex items-center gap-2 font-data text-xs font-semibold uppercase tracking-[0.2em] text-cyan-400">
                        {ar ? 'كل الموديلات' : 'All models'}
                        <span className="font-data text-muted-foreground">{rest.length}</span>
                      </h2>
                    )}
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {rest.map((m) => <ModelCard key={m.id} model={m} showAdminBadges={!!isAdmin} />)}
                    </div>
                  </section>
                )}

                {/* pagination — 100 models per page */}
                {pageCount > 1 && (
                  <div className="flex items-center justify-center gap-3 pt-2">
                    <button
                      onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0 }); }}
                      disabled={safePage <= 1}
                      className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40 hover:border-cyan-500/50"
                    >
                      {ar ? 'السابق' : 'Prev'}
                    </button>
                    <span className="font-data text-sm text-muted-foreground">
                      {safePage} / {pageCount}
                    </span>
                    <button
                      onClick={() => { setPage((p) => Math.min(pageCount, p + 1)); window.scrollTo({ top: 0 }); }}
                      disabled={safePage >= pageCount}
                      className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-40 hover:border-cyan-500/50"
                    >
                      {ar ? 'التالي' : 'Next'}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
      <NewSiteFooter />
    </div>
  );
}
