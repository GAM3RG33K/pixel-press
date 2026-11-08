/**
 * In-app sample fetch for the onboarding "Try with a sample clip" button.
 *
 * Uses CC0 / public-domain Wikimedia Commons files under COEP: require-corp.
 * Verified reachable, CORS-enabled, small enough to embed as a bootstrap.
 */

export const SAMPLE_CLIP_URL =
  "https://upload.wikimedia.org/wikipedia/commons/3/3b/Big_Buck_Bunny_extract.ogv";

export async function fetchSampleClip(): Promise<File> {
  const response = await fetch(SAMPLE_CLIP_URL, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`Sample fetch failed: HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return new File([blob], "sample-video.webm", {
    type: blob.type || "video/webm",
    lastModified: Date.now(),
  });
}