/**
 * PlanReview — transparent "what will ffmpeg do?" panel.
 *
 * Default (Advanced user mode OFF): strictly read-only. Values render as plain
 * text with ● you / ● AI / ● rule / ● preset / ● default badges.
 * Advanced ON: rows become constrained controls that map 1:1 to allowlisted
 * ffmpeg args. Editing a row flips its badge to ● you; the parent locks that
 * field against re-parsing until the intent text changes.
 *
 * Mock reference: brainstorm companion session "plan-review-v2/v3/v4" mockups.
 */

import { useState, type ReactNode } from "react";
import { ChevronDown, Star, X, Zap } from "lucide-react";

import type { VideoMetadata } from "@/types/media";
import { cn } from "@/lib/utils";
import type { EncodeRecipe, RecipeSources, SourceTag } from "@/lib/ffmpeg/recipe";
import type { UserPreset } from "@/lib/settings";

const SOURCE_META: Record<SourceTag, { label: string; className: string }> = {
  you: { label: "you", className: "text-emerald-400" },
  ai: { label: "AI", className: "text-violet-300" },
  rule: { label: "rule", className: "text-sky-300" },
  preset: { label: "preset", className: "text-amber-300" },
  default: { label: "default", className: "text-muted-foreground" },
};

const CONTAINER_CHOICES: { value: EncodeRecipe["outputContainer"]; label: string }[] = [
  { value: "auto", label: "Auto (MP4 + WebM by default)" },
  { value: "same", label: "Keep source container" },
  { value: "mp4", label: "MP4 (.mp4)" },
  { value: "mkv", label: "Matroska (.mkv)" },
  { value: "webm", label: "WebM (.webm)" },
  { value: "mov", label: "QuickTime (.mov)" },
];

const CODEC_CHOICES: { value: EncodeRecipe["targetCodec"]; label: string }[] = [
  { value: "h264", label: "H.264 · libx264" },
  { value: "h265", label: "H.265 · libx265" },
  { value: "vp9", label: "VP9 · libvpx" },
  { value: "av1", label: "AV1 · libsvtav1" },
];

const AUDIO_CHOICES: { value: EncodeRecipe["audioHandling"]; label: string }[] = [
  { value: "copy", label: "Keep (stream copy)" },
  { value: "encode", label: "Re-encode (AAC/Opus)" },
  { value: "strip", label: "Strip (no audio track)" },
];

const SCALE_CHOICES: { value: string; label: string; scale?: { width: number; height: number } }[] = [
  { value: "original", label: "Original" },
  { value: "1080p", label: "1080p (1920×1080)", scale: { width: 1920, height: 1080 } },
  { value: "720p", label: "720p (1280×720)", scale: { width: 1280, height: 720 } },
  { value: "480p", label: "480p (854×480)", scale: { width: 854, height: 480 } },
];

function formatTime(totalSeconds: number): string {
  const ms = Math.round((totalSeconds % 1) * 1000);
  const s = Math.floor(totalSeconds) % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function parseTimeInput(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":");
  if (parts.length < 2 || parts.length > 3) return undefined;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return undefined;
  const [a = 0, b = 0, c] = nums;
  return c === undefined ? a * 60 + b : a * 3600 + b * 60 + c;
}

function sourceFor(sources: RecipeSources, key: keyof EncodeRecipe): SourceTag {
  return sources[key] ?? "default";
}

function Badge({ tag }: { tag: SourceTag }) {
  const meta = SOURCE_META[tag];
  return <span className={cn("text-[11px] whitespace-nowrap", meta.className)}>● {meta.label}</span>;
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-[17px] w-[32px] shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-[2px] size-[13px] rounded-full bg-white transition-all",
          checked ? "left-[17px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

const selectClass =
  "appearance-none rounded-md border border-border bg-background/60 pl-2 pr-6 py-1 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring max-w-[220px]";

function Select({ value, onChange, options, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  ariaLabel: string;
}) {
  return (
    <span className="relative inline-flex items-center">
      <select aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)} className={selectClass}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-1.5 size-3.5 text-muted-foreground" aria-hidden />
    </span>
  );
}

export interface PlanReviewProps {
  recipe: EncodeRecipe;
  sources: RecipeSources;
  /** Advanced user mode — editable rows when true; strictly read-only otherwise. */
  advancedMode: boolean;
  onAdvancedModeChange: (v: boolean) => void;
  /** Called with the updated recipe; parent flips the changed field's badge to ● you. */
  onRecipeChange: (recipe: EncodeRecipe, changed: keyof EncodeRecipe) => void;
  userPresets: UserPreset[];
  onApplyPreset: (preset: UserPreset) => void;
  onDeletePreset: (preset: UserPreset) => void;
  /** Save the current recipe as a preset under this name. */
  onSavePreset: (name: string) => void;
  metadata?: VideoMetadata | null;
  /** Parse notes from the deterministic intent parser (shown as a hint line). */
  intentNotes?: string[];
  className?: string;
}

export function PlanReview({
  recipe,
  sources,
  advancedMode,
  onAdvancedModeChange,
  onRecipeChange,
  userPresets,
  onApplyPreset,
  onDeletePreset,
  onSavePreset,
  metadata,
  intentNotes = [],
  className,
}: PlanReviewProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [presetName, setPresetName] = useState("");

  const set = <K extends keyof EncodeRecipe>(key: K, value: EncodeRecipe[K]) =>
    onRecipeChange({ ...recipe, [key]: value }, key);

  const subtitleOptions = [
    { value: "copy", label: "Keep all (copy)" },
    { value: "strip", label: "Strip all" },
    ...[...new Set((metadata?.subtitleStreams ?? []).map((s) => (s.lang ?? "").toLowerCase()).filter(Boolean))]
      .map((lang) => ({ value: `only:${lang}`, label: `Keep only: ${lang}` })),
  ];
  const subtitleValue =
    recipe.subtitleHandling.mode === "only"
      ? `only:${recipe.subtitleHandling.languages[0] ?? "eng"}`
      : recipe.subtitleHandling.mode;
  const subtitleCount = metadata?.subtitleStreams?.length ?? 0;

  const scaleValue =
    recipe.targetScale?.width === 1920 ? "1080p"
    : recipe.targetScale?.width === 1280 ? "720p"
    : recipe.targetScale?.width === 854 ? "480p"
    : "original";

  const effectiveContainerLabel =
    recipe.outputContainer === "auto" ? "Auto (MP4 + WebM)"
    : recipe.outputContainer === "same" ? `Keep source${metadata?.container ? ` (.${metadata.container.split(",")[0]})` : ""}`
    : recipe.outputContainer.toUpperCase();

  const row = (
    label: ReactNode,
    control: ReactNode,
    tag: SourceTag,
    key: keyof EncodeRecipe,
    opts: { highlight?: boolean } = {},
  ) => (
    <div
      key={key}
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-border/60 px-3 py-2 text-xs",
        opts.highlight && "bg-accent/20",
      )}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground">{control}</span>
      <Badge tag={tag} />
    </div>
  );

  const ro = (text: ReactNode) => <span>{text}</span>;

  return (
    <section aria-label="Plan review" className={cn("overflow-hidden rounded-xl border border-press-paper-edge bg-press-paper", className)}>
      {/* Header + Advanced user mode toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-secondary/40 px-3 py-2">
        <span className="text-xs font-semibold text-foreground">
          <Zap className="mr-1 inline size-3.5 text-warning" aria-hidden />
          Plan review
          <span className="ml-2 font-normal text-muted-foreground">
            {advancedMode ? "advanced — every row is editable" : "read-only · from your intent + AI"}
          </span>
        </span>
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground select-none">
          Advanced user mode
          <Toggle checked={advancedMode} onChange={onAdvancedModeChange} label="Advanced user mode" />
        </label>
      </div>

      {/* User preset chips (advanced only) */}
      {advancedMode && userPresets.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border/60 px-3 py-1.5">
          {userPresets.map((preset) => (
            <span
              key={preset.id}
              className="group inline-flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-400"
            >
              <button type="button" onClick={() => onApplyPreset(preset)} className="inline-flex items-center gap-1 hover:text-emerald-300" title="Apply preset">
                <Star className="size-3 fill-current" aria-hidden />
                {preset.name}
              </button>
              <button
                type="button"
                onClick={() => onDeletePreset(preset)}
                aria-label={`Delete preset ${preset.name}`}
                className="rounded-full p-0.5 text-emerald-500/70 opacity-60 hover:text-emerald-300 hover:opacity-100"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {/* Rows */}
      <div>
        {row(
          "Container / extension",
          advancedMode ? (
            <Select
              ariaLabel="Container"
              value={recipe.outputContainer}
              onChange={(v) => set("outputContainer", v as EncodeRecipe["outputContainer"])}
              options={CONTAINER_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
            />
          ) : (
            ro(effectiveContainerLabel)
          ),
          sourceFor(sources, "outputContainer"),
          "outputContainer",
        )}

        {row(
          "Video codec",
          advancedMode ? (
            <Select
              ariaLabel="Video codec"
              value={recipe.targetCodec}
              onChange={(v) => set("targetCodec", v as EncodeRecipe["targetCodec"])}
              options={CODEC_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
            />
          ) : (
            ro(CODEC_CHOICES.find((c) => c.value === recipe.targetCodec)?.label ?? recipe.targetCodec)
          ),
          sourceFor(sources, "targetCodec"),
          "targetCodec",
        )}

        {row(
          <span>
            CRF <span className="text-muted-foreground/60">· quality</span>
          </span>,
          advancedMode ? (
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                <input
                  type="range"
                  min={18}
                  max={35}
                  step={1}
                  value={recipe.crf}
                  onChange={(e) => set("crf", Number(e.target.value))}
                  className="w-28 accent-primary"
                  aria-label="CRF"
                />
                <b className="tabular-nums">{recipe.crf}</b>
              </span>
              <span className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
                Lower = better quality, bigger file · Higher = smaller file, more artifacts
              </span>
            </span>
          ) : (
            <span className="flex flex-col">
              <span className="text-[13px] tabular-nums">{recipe.crf}</span>
              <span className="text-[10px] leading-snug text-muted-foreground">
                Lower CRF = better quality, bigger file · Higher CRF = smaller file, more artifacts<br />
                <span className="text-muted-foreground/70">{recipe.crf} ≈ strong compression · ±6 CRF ≈ half/double size</span>
              </span>
            </span>
          ),
          sourceFor(sources, "crf"),
          "crf",
          { highlight: true },
        )}

        {row(
          "Audio",
          advancedMode ? (
            <Select
              ariaLabel="Audio handling"
              value={recipe.audioHandling}
              onChange={(v) => set("audioHandling", v as EncodeRecipe["audioHandling"])}
              options={AUDIO_CHOICES}
            />
          ) : (
            ro(AUDIO_CHOICES.find((c) => c.value === recipe.audioHandling)?.label ?? recipe.audioHandling)
          ),
          sourceFor(sources, "audioHandling"),
          "audioHandling",
        )}

        {row(
          <span>
            Subtitles{" "}
            {subtitleCount > 0 ? (
              <span className="text-muted-foreground/60">· {subtitleCount} stream{subtitleCount === 1 ? "" : "s"} found</span>
            ) : (
              <span className="text-muted-foreground/60">· none in source</span>
            )}
          </span>,
          advancedMode ? (
            <Select
              ariaLabel="Subtitle handling"
              value={subtitleValue}
              onChange={(v) => {
                if (v === "copy") set("subtitleHandling", { mode: "copy" });
                else if (v === "strip") set("subtitleHandling", { mode: "strip" });
                else set("subtitleHandling", { mode: "only", languages: [v.slice("only:".length)] });
              }}
              options={subtitleOptions}
            />
          ) : (
            ro(
              recipe.subtitleHandling.mode === "only"
                ? `Keep only: ${recipe.subtitleHandling.languages.join(", ")}`
                : recipe.subtitleHandling.mode === "strip"
                  ? "Strip all"
                  : "Keep all (copy)",
            )
          ),
          sourceFor(sources, "subtitleHandling"),
          "subtitleHandling",
        )}

        {row(
          "Metadata",
          advancedMode ? (
            <span className="flex items-center gap-2">
              <Toggle
                checked={recipe.stripMetadata}
                onChange={(v) => set("stripMetadata", v)}
                label="Strip metadata"
              />
              <span>{recipe.stripMetadata ? "strip" : "keep"}</span>
            </span>
          ) : (
            ro(recipe.stripMetadata ? "Strip" : "Keep")
          ),
          sourceFor(sources, "stripMetadata"),
          "stripMetadata",
        )}

        {row(
          "Faststart (web streaming)",
          advancedMode ? (
            <span className="flex items-center gap-2">
              <Toggle
                checked={recipe.faststart}
                onChange={(v) => set("faststart", v)}
                label="Faststart"
              />
              <span>{recipe.faststart ? "on (mp4/mov)" : "off"}</span>
            </span>
          ) : (
            ro(recipe.faststart ? "On (mp4/mov)" : "Off")
          ),
          sourceFor(sources, "faststart"),
          "faststart",
        )}

        {row(
          "Resolution",
          advancedMode ? (
            <Select
              ariaLabel="Resolution"
              value={scaleValue}
              onChange={(v) => {
                const choice = SCALE_CHOICES.find((c) => c.value === v);
                set("targetScale", choice?.scale ? { ...choice.scale } : undefined);
              }}
              options={SCALE_CHOICES.map((c) => ({ value: c.value, label: c.label }))}
            />
          ) : (
            ro(
              recipe.targetScale
                ? `${recipe.targetScale.width}×${recipe.targetScale.height}`
                : `Original${metadata ? ` · ${metadata.width}×${metadata.height}` : ""}`,
            )
          ),
          sourceFor(sources, "targetScale"),
          "targetScale",
        )}

        {row(
          "Trim",
          advancedMode ? (
            <span className="flex items-center gap-1.5">
              <input
                inputMode="decimal"
                placeholder="start"
                aria-label="Trim start (seconds or hh:mm:ss)"
                defaultValue={recipe.trimStart !== undefined ? String(recipe.trimStart) : ""}
                onBlur={(e) => {
                  const parsed = parseTimeInput(e.target.value);
                  set("trimStart", parsed);
                }}
                className="w-16 rounded-md border border-border bg-background/60 px-1.5 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <span className="text-muted-foreground">→</span>
              <input
                inputMode="decimal"
                placeholder="end"
                aria-label="Trim end (seconds or hh:mm:ss)"
                defaultValue={recipe.trimEnd !== undefined ? String(recipe.trimEnd) : ""}
                onBlur={(e) => {
                  const parsed = parseTimeInput(e.target.value);
                  set("trimEnd", parsed);
                }}
                className="w-16 rounded-md border border-border bg-background/60 px-1.5 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {(recipe.trimStart !== undefined || recipe.trimEnd !== undefined) ? (
                <button type="button" aria-label="Clear trim" onClick={() => { set("trimStart", undefined); set("trimEnd", undefined); }} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground">
                  <X className="size-3" aria-hidden />
                </button>
              ) : null}
            </span>
          ) : (
            ro(
              recipe.trimStart !== undefined || recipe.trimEnd !== undefined
                ? `${formatTime(recipe.trimStart ?? 0)} → ${recipe.trimEnd !== undefined ? formatTime(recipe.trimEnd) : "end"}`
                : `None${metadata ? ` — 00:00.000 → ${formatTime(metadata.duration)}` : ""}`,
            )
          ),
          sourceFor(sources, "trimStart"),
          "trimStart",
        )}
      </div>

      {/* Footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 bg-secondary/40 px-3 py-2">
        <span className="text-[10.5px] text-muted-foreground">
          {advancedMode
            ? "Editing a row flips it to ● you and locks it against re-parsing."
            : "Values update only when the intent text changes. Turn on Advanced user mode to edit."}
          {intentNotes.length > 0 ? (
            <span className="block text-[10px] text-muted-foreground/80">Parsed from intent: {intentNotes.join(" · ")}</span>
          ) : null}
        </span>
        {advancedMode ? (
          <button
            type="button"
            onClick={() => setSaveOpen((v) => !v)}
            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/20"
          >
            ＋ Save current as preset…
          </button>
        ) : null}
      </div>

      {/* Save-preset dialog (inline) */}
      {saveOpen && advancedMode ? (
        <div className="border-t border-border/60 bg-card/60 px-3 py-2">
          <label htmlFor="preset-name" className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Preset name</label>
          <input
            id="preset-name"
            autoFocus
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && presetName.trim()) {
                onSavePreset(presetName.trim());
                setPresetName("");
                setSaveOpen(false);
              } else if (e.key === "Escape") {
                setSaveOpen(false);
              }
            }}
            placeholder='e.g. "Archival MKV"'
            className="mt-1 w-full rounded-md border border-border bg-background/60 px-2 py-1.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-1.5 flex justify-end gap-1.5">
            <button type="button" onClick={() => setSaveOpen(false)} className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground">Cancel</button>
            <button
              type="button"
              disabled={!presetName.trim()}
              onClick={() => {
                onSavePreset(presetName.trim());
                setPresetName("");
                setSaveOpen(false);
              }}
              className="rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:brightness-110 disabled:opacity-40"
            >
              Save preset
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
