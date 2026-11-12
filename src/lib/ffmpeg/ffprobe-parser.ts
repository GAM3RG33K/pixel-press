import type { VideoMetadata } from "@/types/media";

interface FfprobeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  pix_fmt?: string;
  bit_rate?: string;
  duration?: string;
  index?: number;
  tags?: { language?: string; title?: string };
}

interface FfprobeFormat {
  format_name?: string;
  duration?: string;
  bit_rate?: string;
  size?: string;
}

interface FfprobeJson {
  streams?: FfprobeStream[];
  format?: FfprobeFormat;
}

function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [numerator, denominator] = value.split("/");
  if (denominator === undefined) return Number(value) || 0;
  const n = Number(numerator);
  const d = Number(denominator);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return 0;
  return n / d;
}

function toNumber(value: string | number | undefined): number {
  if (value === undefined) return 0;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

let metadataCounter = 0;

/**
 * Converts ffprobe's JSON output into the app's `VideoMetadata` shape.
 * `raw` output is kept by the caller for debugging.
 */
export function parseFfprobeJson(
  rawJson: string,
  fileName: string,
  fileSize: number,
): VideoMetadata {
  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(rawJson) as FfprobeJson;
  } catch {
    throw new Error("ffprobe returned invalid JSON");
  }

  const streams = parsed.streams ?? [];
  const video = streams.find((stream) => stream.codec_type === "video");
  if (!video) {
    throw new Error("No video stream found");
  }

  const audio = streams.find((stream) => stream.codec_type === "audio");
  const audioLanguages = streams
    .filter((stream) => stream.codec_type === "audio")
    .map((stream) => stream.tags?.language ?? "")
    .filter((lang) => lang.length > 0);
  const subtitleStreams = streams
    .filter((stream) => stream.codec_type === "subtitle")
    .map((stream) => {
      const entry: NonNullable<VideoMetadata["subtitleStreams"]>[number] = {
        index: stream.index ?? -1,
      };
      if (stream.codec_name) entry.codec = stream.codec_name;
      if (stream.tags?.language) entry.lang = stream.tags.language;
      if (stream.tags?.title) entry.title = stream.tags.title;
      return entry;
    });
  const format = parsed.format ?? {};

  metadataCounter += 1;
  const metadata: VideoMetadata = {
    id: `video-${Date.now()}-${metadataCounter}`,
    fileName,
    fileSize: fileSize > 0 ? fileSize : toNumber(format.size),
    duration: toNumber(format.duration) || toNumber(video.duration),
    container: format.format_name ?? "",
    videoCodec: video.codec_name ?? "unknown",
    width: video.width ?? 0,
    height: video.height ?? 0,
    fps: parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate),
    bitrate: toNumber(format.bit_rate) || toNumber(video.bit_rate),
    pixelFormat: video.pix_fmt ?? "",
    hasAudio: Boolean(audio),
  };

  if (audio) {
    if (audio.codec_name) metadata.audioCodec = audio.codec_name;
    const audioBitrate = toNumber(audio.bit_rate);
    if (audioBitrate > 0) metadata.audioBitrate = audioBitrate;
  }
  if (audioLanguages.length > 0) metadata.audioLanguages = audioLanguages;
  if (subtitleStreams.length > 0) metadata.subtitleStreams = subtitleStreams;

  return metadata;
}
