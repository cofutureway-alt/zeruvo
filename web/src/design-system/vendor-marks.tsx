// Vendor marks for the canonical ai_providers catalog.
// Real SVG marks where available; otherwise a colored monogram tile so
// every vendor has a stable, recognizable identity in the console.
import type { ReactElement, SVGProps } from "react";
import {
  ProviderMark,
  OpenaiMark,
  AnthropicMark,
  ZhipuMark,
  DeepseekMark,
  MoonshotMark,
  QwenMark,
  MistralMark,
  XaiMark,
  PerplexityMark,
} from "./brand-marks";

type IconProps = SVGProps<SVGSVGElement>;

export interface VendorMeta {
  label: string;
  color: string;
}

/** slug → brand metadata (fallback monogram color + display label). */
export const VENDOR_META: Record<string, VendorMeta> = {
  openai:     { label: "OpenAI",            color: "#10a37f" },
  anthropic:  { label: "Anthropic",         color: "#d97757" },
  google:     { label: "Google",            color: "#4285f4" },
  "meta-llama": { label: "Meta Llama",      color: "#0866ff" },
  deepseek:   { label: "DeepSeek",          color: "#4d6bfe" },
  "x-ai":     { label: "xAI (Grok)",        color: "#e5e7eb" },
  mistralai:  { label: "Mistral AI",        color: "#fa520f" },
  qwen:       { label: "Alibaba Qwen",      color: "#615ced" },
  moonshotai: { label: "MoonshotAI (Kimi)", color: "#00b96b" },
  "z-ai":     { label: "Z.ai (GLM)",        color: "#3b82f6" },
  minimax:    { label: "MiniMax",           color: "#f23f5d" },
  ollama:     { label: "Ollama",            color: "#e6e6e6" },
  microsoft:  { label: "Microsoft",         color: "#00a4ef" },
  nvidia:     { label: "NVIDIA",            color: "#76b900" },
  cohere:     { label: "Cohere",            color: "#39594d" },
  perplexity: { label: "Perplexity",        color: "#20b8cd" },
  amazon:     { label: "Amazon Nova",       color: "#ff9900" },
  ai2:        { label: "Allen AI",          color: "#f5a623" },
  baidu:      { label: "Baidu",             color: "#2932e1" },
  bytedance:  { label: "ByteDance",         color: "#325ab4" },
  tencent:    { label: "Tencent",           color: "#0052d9" },
  xiaomi:     { label: "Xiaomi",            color: "#ff6900" },
  "stepfun-ai": { label: "StepFun",         color: "#2170f0" },
  "01-ai":    { label: "01.AI (Yi)",        color: "#003425" },
  ai21:       { label: "AI21 Labs",         color: "#e05252" },
  liquid:     { label: "Liquid AI",         color: "#7c5cff" },
  openrouter: { label: "OpenRouter",        color: "#8b5cf6" },
  other:      { label: "Other",             color: "#71717a" },
};

const slugMarks: Record<string, (props: IconProps) => ReactElement> = {
  openai: OpenaiMark,
  anthropic: AnthropicMark,
  "z-ai": ZhipuMark,
  deepseek: DeepseekMark,
  moonshotai: MoonshotMark,
  qwen: QwenMark,
  mistralai: MistralMark,
  "x-ai": XaiMark,
  perplexity: PerplexityMark,
};

function MonogramMark({ slug, ...props }: IconProps & { slug: string }) {
  const meta = VENDOR_META[slug] ?? VENDOR_META.other;
  const initials = meta.label
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase() || "?";
  return (
    <svg viewBox="0 0 24 24" role="img" aria-label={meta.label} {...props}>
      <rect x="0" y="0" width="24" height="24" rx="6" fill={meta.color} opacity="0.16" />
      <rect x="0.75" y="0.75" width="22.5" height="22.5" rx="5.25" fill="none" stroke={meta.color} strokeWidth="1" opacity="0.55" />
      <text
        x="12"
        y="12"
        textAnchor="middle"
        dominantBaseline="central"
        fontSize="9.5"
        fontWeight="700"
        fill={meta.color}
        fontFamily="inherit"
      >
        {initials}
      </text>
    </svg>
  );
}

/**
 * Canonical vendor icon by ai_providers.slug. Falls back through
 * ProviderMark's name matching, then a colored monogram tile.
 */
export function VendorMark({ slug, className, ...props }: IconProps & { slug: string | null | undefined }) {
  const key = slug ?? "other";
  const Mark = slugMarks[key];
  if (Mark) return <Mark className={className} {...props} />;
  const meta = VENDOR_META[key];
  if (meta) {
    // ProviderMark regex-matches known names (google/meta/etc. handled upstream later)
    return <MonogramMark slug={key} className={className} {...props} />;
  }
  return <ProviderMark name={key} className={className} {...props} />;
}

export function vendorLabel(slug: string | null | undefined): string {
  return VENDOR_META[slug ?? "other"]?.label ?? slug ?? "Other";
}

export function vendorColor(slug: string | null | undefined): string {
  return VENDOR_META[slug ?? "other"]?.color ?? "#71717a";
}
