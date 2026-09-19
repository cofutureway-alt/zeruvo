// ModelCard — the dark catalog card (provider mark, availability, discount,
// blended price / context, throughput stats, modality I/O icons, rating).
import { Link } from 'react-router-dom';
import { CheckCircle2, BadgePercent, Gauge, Layers, Star, Sparkles } from 'lucide-react';
import { VendorMark, vendorLabel } from '../design-system/vendor-marks';
import { compactTokens } from './console-kit';

export interface ModelCardData {
  id: string;
  slug: string;
  display_name: string;
  vendor_slug: string | null;
  vendor_name?: string | null;
  context_window: number | null;
  payg_enabled: boolean;
  usage_multiplier: number | string;
  enabled_for_users: boolean;
  is_priced: boolean;
  is_featured?: boolean;
  is_custom?: boolean;
  input_modalities: string[] | null;
  output_modalities: string[] | null;
  supports_reasoning?: boolean;
  tok_per_s?: number | null;
  avg_ttft_ms?: number | null;
  quality_score?: number | null;
  input_price: number | string | null;
  output_price: number | string | null;
  discount_percent?: number | string | null;
}

function ModalitySet({ mods }: { mods: string[] | null }) {
  const list = mods ?? ['text'];
  const entries: Array<{ key: string; label: string }> = [
    { key: 'text', label: 'Text' },
    { key: 'image', label: 'Image' },
    { key: 'audio', label: 'Audio' },
    { key: 'video', label: 'Video' },
  ];
  return (
    <div className="flex items-center gap-1.5">
      {entries.map(({ key, label }) => {
        const on = list.includes(key);
        return (
          <span
            key={key}
            title={label}
            className={`grid size-8 place-items-center rounded-lg border text-[13px] transition-colors ${
              on
                ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                : 'border-border/60 text-muted-foreground/35'
            }`}
          >
            {key === 'text' ? <span className="font-serif font-semibold">T</span>
              : key === 'image' ? <IconImage />
              : key === 'audio' ? <IconAudio />
              : <IconVideo />}
          </span>
        );
      })}
    </div>
  );
}

// inline 16px stroke icons (lucide-shaped) to keep the tile compact
function IconImage() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect width="18" height="18" x="3" y="3" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}
function IconAudio() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3" />
    </svg>
  );
}
function IconVideo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" />
    </svg>
  );
}

function Stars({ score }: { score: number | null | undefined }) {
  if (score == null) return null;
  const rounded = Math.round(Number(score));
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={13}
          className={i <= rounded ? 'fill-cyan-400 text-cyan-400' : 'text-muted-foreground/40'}
        />
      ))}
    </div>
  );
}

export function blendedPrice(input: number | string | null, output: number | string | null): number | null {
  const i = input != null ? Number(input) : null;
  const o = output != null ? Number(output) : null;
  if (i == null && o == null) return null;
  if (i == null) return o!;
  if (o == null) return i;
  return (3 * i + o) / 4;
}

export function ModelCard({ model, showAdminBadges = false }: { model: ModelCardData; showAdminBadges?: boolean }) {
  const blended = blendedPrice(model.input_price, model.output_price);
  const discount = model.discount_percent != null ? Number(model.discount_percent) : 0;
  const hasPrices = model.input_price != null || model.output_price != null;
  const available = model.enabled_for_users && (model.is_priced || showAdminBadges);

  return (
    <Link
      to={`/models/${model.slug}`}
      data-slot="model-card"
      className="spotlight-card group flex h-full flex-col gap-4 rounded-2xl border border-border bg-[var(--nx-surface)] p-5 transition-all hover:border-cyan-500/40 hover:shadow-[0_0_28px_rgba(6,182,212,0.12)]"
    >
      {/* header: mark + name / vendor, availability */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl border border-border bg-[var(--console-elevated)] p-2 text-cyan-400">
            <VendorMark slug={model.vendor_slug} className="size-full" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate font-console-display text-lg font-semibold tracking-tight text-foreground group-hover:text-cyan-300">
              {model.display_name}
              {model.is_custom && <Sparkles size={13} className="ms-1.5 inline text-violet-400" />}
            </h3>
            <p className="truncate text-sm text-muted-foreground">
              {model.vendor_name || vendorLabel(model.vendor_slug)}
            </p>
          </div>
        </div>
        {available ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-cyan-500/50 px-2.5 py-1.5 text-xs font-semibold text-cyan-400">
            <CheckCircle2 size={13} /> Available
          </span>
        ) : showAdminBadges ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/5 px-2.5 py-1.5 text-xs font-semibold text-red-400">
            Unpriced
          </span>
        ) : null}
      </div>

      {/* badges row */}
      {(discount > 0 || model.is_featured || !model.is_priced) && (
        <div className="flex flex-wrap items-center gap-2">
          {discount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/5 px-3 py-1.5 text-sm font-semibold text-amber-400">
              <BadgePercent size={15} /> {Math.round(discount)}% off
            </span>
          )}
          {model.is_featured && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/50 bg-violet-500/5 px-2.5 py-1 text-xs font-medium text-violet-400">
              <Star size={12} className="fill-violet-400" /> Recommended
            </span>
          )}
          {showAdminBadges && !model.is_priced && (
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-500/5 px-2.5 py-1 text-xs font-medium text-red-400">
              Unpriced
            </span>
          )}
        </div>
      )}

      {/* price + context */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Blended price / 1M</p>
          <p className="mt-0.5 font-data text-xl font-medium tabular-nums text-foreground">
            {blended != null ? `$${blended.toFixed(blended < 1 ? 3 : 2)}` : '—'}
            {hasPrices && <span className="ms-1.5 text-xs text-muted-foreground">in/out</span>}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Context</p>
          <p className="mt-0.5 font-data text-xl font-medium tabular-nums text-foreground">
            {model.context_window ? compactTokens(model.context_window) : '—'}
          </p>
        </div>
      </div>

      {/* live stats */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 font-data text-sm text-cyan-300/80">
        <span className="inline-flex items-center gap-1.5">
          <Gauge size={14} /> {model.tok_per_s ? `${Math.round(Number(model.tok_per_s))} tok/s` : 'n/a'}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Layers size={14} /> {model.avg_ttft_ms ? `${(Number(model.avg_ttft_ms) / 1000).toFixed(2)}s ttft` : `${Number(model.usage_multiplier) || 1}× plan`}
        </span>
        {model.supports_reasoning && (
          <span className="rounded border border-violet-500/40 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-violet-300">
            Reasoning
          </span>
        )}
      </div>

      <div className="mt-auto border-t border-border/70 pt-4">
        <div className="flex items-center justify-between gap-2">
          <ModalitySet mods={model.input_modalities} />
          <span className="font-data text-muted-foreground/50">/</span>
          <ModalitySet mods={model.output_modalities} />
        </div>
        {model.quality_score != null && (
          <div className="mt-3 flex items-center gap-2">
            <Stars score={model.quality_score} />
            <span className="font-data text-xs text-muted-foreground">
              {Number(model.quality_score).toFixed(2)} / 5
            </span>
          </div>
        )}
      </div>
    </Link>
  );
}
