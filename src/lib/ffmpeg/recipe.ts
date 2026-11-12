/**
 * EncodeRecipe — the widened, user-facing plan.
 *
 * `CompressionPlan` (AI/rules output) is intentionally narrow: codec/CRF/audio.
 * `EncodeRecipe` adds the parameters beta users actually ask for in plain
 * language: container/extension retention, subtitle handling, metadata strip,
 * trim. Every field maps 1:1 to an allowlisted ffmpeg argument — no free text
 * ever reaches the command line.
 *
 * Resolution order (later wins for hand-locked `you` fields only):
 *   1. defaults
 *   2. AI or rule-engine plan
 *   3. deterministic intent constraints (applyIntentConstraints)
 *   4. preset application (preset wins over AI, never over explicit intent tokens —
 *      except when preset is applied deliberately after the fact, then it wins and
 *      re-parse is required to unlock the intent again)
 */

import type { CompressionPlan } from "@/skills/compress-video-rules";
import type { TargetCodec, VideoMetadata } from "@/types/media";

export type OutputContainer = "auto" | "same" | "mp4" | "mkv" | "webm" | "mov";
export type AudioHandling = "copy" | "encode" | "strip";
export type SubtitleHandling =
  | { mode: "copy" }
  | { mode: "strip" }
  | { mode: "only"; languages: string[] };

export interface EncodeRecipe {
  targetCodec: TargetCodec;
  crf: number;
  twoPass?: boolean;
  preserveKeyframes?: boolean;
  targetScale?: { width?: number; height?: number };
  /** Container the output should use. `auto` = variant builder decides (MP4+WebM unless intent narrows); `same` = retain the source extension. */
  outputContainer: OutputContainer;
  audioHandling: AudioHandling;
  subtitleHandling: SubtitleHandling;
  stripMetadata: boolean;
  faststart: boolean;
  /** Trim window in seconds; undefined = whole duration. */
  trimStart?: number;
  trimEnd?: number;
}

export type SourceTag = "you" | "ai" | "rule" | "preset" | "default";

export type RecipeSources = Partial<Record<keyof EncodeRecipe, SourceTag>>;

export interface ResolvedRecipe {
  recipe: EncodeRecipe;
  sources: RecipeSources;
  /** True when the intent clearly asked for a customization the rule engine cannot express. */
  unhandledCustomization: boolean;
  /** Human-readable list of what the deterministic parser pinned down (shown in the UI). */
  intentNotes: string[];
}

export const DEFAULT_RECIPE: EncodeRecipe = {
  targetCodec: "h264",
  crf: 26,
  outputContainer: "auto",
  audioHandling: "copy",
  subtitleHandling: { mode: "copy" },
  stripMetadata: false,
  faststart: true,
};

export function defaultRecipeSources(): RecipeSources {
  return {
    targetCodec: "default",
    crf: "default",
    outputContainer: "default",
    audioHandling: "default",
    subtitleHandling: "default",
    stripMetadata: "default",
    faststart: "default",
    trimStart: "default",
    trimEnd: "default",
    targetScale: "default",
    twoPass: "default",
    preserveKeyframes: "default",
  };
}

/** Map a (validated) CompressionPlan onto defaults. */
export function recipeFromPlan(plan: CompressionPlan, used: "ai" | "rule-engine"): ResolvedRecipe {
  const source: SourceTag = used === "ai" ? "ai" : "rule";
  const audioHandling: AudioHandling = plan.audioHandling ?? "copy";
  const recipe: EncodeRecipe = {
    ...DEFAULT_RECIPE,
    targetCodec: plan.targetCodec,
    crf: plan.crf,
    audioHandling,
    // mp4 family gets faststart by default — cheap and universally good for web delivery
    faststart: true,
  };
  if (plan.twoPass !== undefined) recipe.twoPass = plan.twoPass;
  if (plan.preserveKeyframes !== undefined) recipe.preserveKeyframes = plan.preserveKeyframes;
  if (plan.targetScale) recipe.targetScale = plan.targetScale;
  const sources = defaultRecipeSources();
  sources.targetCodec = source;
  sources.crf = source;
  sources.audioHandling = source;
  if (plan.twoPass !== undefined) sources.twoPass = source;
  if (plan.preserveKeyframes !== undefined) sources.preserveKeyframes = source;
  if (plan.targetScale) sources.targetScale = source;
  return { recipe, sources, unhandledCustomization: false, intentNotes: [] };
}

export interface IntentConstraints {
  recipe: Partial<Omit<EncodeRecipe, "subtitleHandling">> & {
    subtitleHandling?: SubtitleHandling;
  };
  notes: string[];
  /** True when the intent names a customization keyword we could not parse. */
  unhandled: boolean;
}

const LANG_ALIASES: Record<string, string[]> = {
  english: ["eng"],
  eng: ["eng"],
  hindi: ["hin"],
  hin: ["hin"],
  spanish: ["spa"],
  spa: ["spa"],
  french: ["fre", "fra"],
  fre: ["fre", "fra"],
  fra: ["fra"],
  german: ["ger", "deu"],
  ger: ["ger", "deu"],
  deu: ["deu"],
  japanese: ["jpn"],
  jpn: ["jpn"],
  chinese: ["chi", "zho"],
  chi: ["chi", "zho"],
  zho: ["zho"],
  corean: ["kor"],
  korean: ["kor"],
  kor: ["kor"],
  russian: ["rus"],
  rus: ["rus"],
  portuguese: ["por"],
  por: ["por"],
  arabic: ["ara"],
  ara: ["ara"],
  tamil: ["tam"],
  tam: ["tam"],
  telugu: ["tel"],
  tel: ["tel"],
  kannada: ["kan"],
  kan: ["kan"],
  malayalam: ["mal"],
  mal: ["mal"],
};

const EXT_RE = /\.(mkv|mp4|webm|mov|avi|m4v)\b/i;
const KEEP_CONTAINER_RE = /(keep|retain|preserve|stay(?:s|ing)?|same)\s+(?:the\s+)?(?:original\s+)?(?:container|extension|format|file)?\s*(\.[a-z0-9]{2,4}\b)?/i;
const CONVERT_TO_RE = /(?:convert|encode|export|output|save|make)\s+(?:it\s+)?(?:to|as|into)\s+(?:an?\s+)?(\.?(?:mkv|mp4|webm|mov|avi|m4v))\b/i;
const AS_EXT_RE = /\bas\s+(?:an?\s+)?(\.?(?:mkv|mp4|webm|mov|avi|m4v))\b/i;

function normalizeLang(word: string): string[] {
  const key = word.toLowerCase();
  return LANG_ALIASES[key] ?? [key];
}

function parseTimestamp(raw: string): number | undefined {
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n))) return undefined;
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return (parts[0] ?? 0) * 60 + (parts[1] ?? 0);
  return (parts[0] ?? 0) * 3600 + (parts[1] ?? 0) * 60 + (parts[2] ?? 0);
}

/**
 * Deterministic extraction of hard constraints from plain-language intent.
 * Only high-confidence, anchored patterns are honored; anything ambiguous is
 * left to the AI/rule engine. Sets `unhandled` when the intent names a
 * customization we could not pin down.
 */
export function parseIntentConstraints(intent: string, metadata?: VideoMetadata | null): IntentConstraints {
  const text = intent.trim();
  const notes: string[] = [];
  const recipe: IntentConstraints["recipe"] = {};
  if (!text) return { recipe, notes, unhandled: false };
  const lower = text.toLowerCase();

  let matchedSomething = false;

  // --- container / extension ---
  const convert = CONVERT_TO_RE.exec(lower) ?? AS_EXT_RE.exec(lower);
  if (convert?.[1]) {
    const ext = convert[1].replace(/^\./, "").toLowerCase();
    const mapped: Record<string, OutputContainer> = { mkv: "mkv", mp4: "mp4", m4v: "mp4", webm: "webm", mov: "mov", avi: "mkv" };
    recipe.outputContainer = mapped[ext] ?? "same";
    notes.push(`container → ${ext === "avi" || ext === "m4v" ? `${mapped[ext]} (${ext} not supported, mapped)` : ext}`);
    matchedSomething = true;
  } else if (KEEP_CONTAINER_RE.test(lower) && (EXT_RE.test(lower) || /container|extension|format|same/i.test(lower))) {
    recipe.outputContainer = "same";
    notes.push("container → keep source");
    matchedSomething = true;
  } else {
    // Loose rule: a bare container token narrows the output (e.g. "h264 mp4").
    const standalone = /\b(mkv|mp4|m4v|webm|mov|avi)\b/i.exec(lower);
    if (standalone?.[1]) {
      const ext = standalone[1].toLowerCase();
      const mapped: Record<string, OutputContainer> = { mkv: "mkv", mp4: "mp4", m4v: "mp4", webm: "webm", mov: "mov", avi: "mkv" };
      recipe.outputContainer = mapped[ext] ?? "auto";
      notes.push(`container → ${recipe.outputContainer} (mentioned)`);
      matchedSomething = true;
    }
  }

  // --- audio ---
  if (/(strip|remove|drop|no|mute|without)\s+(?:all\s+)?(?:the\s+)?audio|no audio|audio[- ]?less|\bmute\b/i.test(lower)) {
    recipe.audioHandling = "strip";
    notes.push("audio → strip");
    matchedSomething = true;
  } else if (/(keep|preserve|retain)\s+(?:the\s+)?audio|with audio|keep(?:ing)? sound/i.test(lower)) {
    recipe.audioHandling = "copy";
    notes.push("audio → keep (copy)");
    matchedSomething = true;
  }

  // --- subtitles ---
  const subStreams = metadata?.subtitleStreams ?? [];
  const subLangs = [...new Set(subStreams.map((s) => (s.lang ?? "").toLowerCase()).filter(Boolean))];
  const exceptMatch = /(?:all\s+)?sub(?:s|titles)?\s+except\s+(?:the\s+)?([a-z]{2,4})/i.exec(lower);
  const keepOnlyMatch = /keep\s+(?:only\s+)?(?:the\s+)?([a-z]{2,16})\s+sub(?:s|titles)?/i.exec(lower)
    ?? /(?:only\s+)?([a-z]{3})\s+sub(?:s|titles)?\s+(?:only|wanted|needed)/i.exec(lower);
  if (/(?:strip|remove|drop|no|without)\s+(?:all\s+)?(?:the\s+)?sub(?:s|titles)?/i.test(lower)) {
    recipe.subtitleHandling = { mode: "strip" };
    notes.push("subtitles → strip");
    matchedSomething = true;
  } else if (exceptMatch?.[1]) {
    const excluded = normalizeLang(exceptMatch[1]);
    if (subLangs.length > 0) {
      const wanted = subLangs.filter((l) => !excluded.includes(l));
      recipe.subtitleHandling = wanted.length > 0 ? { mode: "only", languages: wanted } : { mode: "strip" };
      notes.push(`subtitles → keep ${wanted.join("/") || "none"} (all except ${excluded.join("/")})`);
      matchedSomething = true;
    }
    // without stream info the request cannot be decided deterministically — leave to AI (flagged unhandled)
  } else if (keepOnlyMatch?.[1]) {
    const wanted = normalizeLang(keepOnlyMatch[1]);
    recipe.subtitleHandling = { mode: "only", languages: wanted };
    notes.push(`subtitles → keep only ${wanted.join("/")}`);
    matchedSomething = true;
  } else if (/keep\s+(?:all\s+)?(?:the\s+)?sub(?:s|titles)?/i.test(lower)) {
    recipe.subtitleHandling = { mode: "copy" };
    notes.push("subtitles → copy");
    matchedSomething = true;
  }

  // --- metadata ---
  if (/(strip|remove|drop|clean)\s+(?:all\s+)?(?:the\s+)?metadata/i.test(lower)) {
    recipe.stripMetadata = true;
    notes.push("metadata → strip");
    matchedSomething = true;
  } else if (/keep\s+(?:the\s+)?metadata/i.test(lower)) {
    recipe.stripMetadata = false;
    notes.push("metadata → keep");
    matchedSomething = true;
  }

  // --- trim ---
  const trimMatch = /(?:trim|cut)\s+(?:from\s+)?(\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)\s+(?:to|-|–)\s+(\d{1,2}(?::\d{1,2}){0,2}(?:\.\d+)?)/i.exec(lower);
  const firstMatch = /first\s+(\d+)\s*(seconds?|secs?|s\b|minutes?|mins?|m\b)/i.exec(lower);
  if (trimMatch?.[1] && trimMatch[2]) {
    const start = parseTimestamp(trimMatch[1]);
    const end = parseTimestamp(trimMatch[2]);
    if (start !== undefined && end !== undefined && end > start) {
      recipe.trimStart = start;
      recipe.trimEnd = end;
      notes.push(`trim → ${start}s–${end}s`);
      matchedSomething = true;
    }
  } else if (firstMatch?.[1] && firstMatch[2]) {
    const amount = Number(firstMatch[1]);
    const unit = firstMatch[2].toLowerCase();
    const seconds = /^m/.test(unit) ? amount * 60 : amount;
    recipe.trimStart = 0;
    recipe.trimEnd = seconds;
    notes.push(`trim → first ${seconds}s`);
    matchedSomething = true;
  }

  // --- unhandled customization detection ---
  const CUSTOMIZATION_KEYWORDS = [
    "subtitle", "subtitles", "subs",
    "extension", "container", "format",
    "metadata", "trim", "audio track",
    "rotate", "crop", "fps", "framerate", "frame rate",
    "under ", "smaller than", "fit under", "target size", "max size",
    "megabyte", "gigabyte",
  ];
  const SIZE_TARGET_RE = /\d+(\.\d+)?\s*(mb|gb)\b/i;
  const mentionsCustomization =
    CUSTOMIZATION_KEYWORDS.some((k) => lower.includes(k)) || SIZE_TARGET_RE.test(lower);
  const unhandled = mentionsCustomization && !matchedSomething;

  return { recipe, notes, unhandled };
}

/**
 * Apply deterministic intent constraints on top of an AI/rules-resolved recipe.
 * Explicit intent tokens always win; the AI never overrides them.
 */
export function applyIntentConstraints(
  base: ResolvedRecipe,
  intent: string,
  metadata?: VideoMetadata | null,
): ResolvedRecipe {
  const constraints = parseIntentConstraints(intent, metadata);
  if (constraints.notes.length === 0 && !constraints.unhandled) {
    return { ...base, unhandledCustomization: false };
  }
  const recipe = { ...base.recipe };
  const sources = { ...base.sources };
  for (const [key, value] of Object.entries(constraints.recipe)) {
    if (value === undefined) continue;
    const k = key as keyof EncodeRecipe;
    (recipe as Record<string, unknown>)[k] = value;
    sources[k] = "you";
  }
  return {
    recipe,
    sources,
    unhandledCustomization: constraints.unhandled,
    intentNotes: [...base.intentNotes, ...constraints.notes],
  };
}

/** Map the variant-selection container out of a recipe (`same` ⇒ source container; `auto` is resolved by the variant builder). */
export function resolveOutputContainer(recipe: EncodeRecipe, metadata: VideoMetadata | null): OutputContainer {
  if (recipe.outputContainer === "auto") return "auto";
  if (recipe.outputContainer !== "same") return recipe.outputContainer;
  const source = (metadata?.container ?? "").toLowerCase();
  if (source.includes("matroska") || source.includes("mkv")) return "mkv";
  if (source.includes("webm")) return "webm";
  if (source.includes("quicktime") || source.includes("mov")) return "mov";
  return "mp4";
}

/** Canonical file extension for a resolved container. */
export function extensionFor(container: OutputContainer): string {
  switch (container) {
    case "mkv": return "mkv";
    case "webm": return "webm";
    case "mov": return "mov";
    default: return "mp4";
  }
}
