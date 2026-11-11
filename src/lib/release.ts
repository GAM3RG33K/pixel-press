/** Compare release tags `vX.Y.Z[-dev]`: a<b → -1, a==b → 0, a>b → 1. */
export function compareReleaseTags(a: string, b: string): number {
  const parse = (s: string) => s.replace(/^v/, "").split("-");
  const [aNum = "", aPre] = parse(a);
  const [bNum = "", bPre] = parse(b);
  const as = aNum.split(".").map(Number);
  const bs = bNum.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const ai = Number.isFinite(as[i]) ? (as[i] as number) : 0;
    const bi = Number.isFinite(bs[i]) ? (bs[i] as number) : 0;
    if (ai !== bi) return ai < bi ? -1 : 1;
  }
  // same numbers: release (no suffix) > dev prerelease
  if ((aPre ?? "") === (bPre ?? "")) return 0;
  if (!aPre) return 1;
  if (!bPre) return -1;
  if (aPre === bPre) return 0;
  return aPre < bPre ? -1 : 1;
}

export function isUpdateAvailable(running: string, latest: string): boolean {
  return compareReleaseTags(running.replace(/^v/, ""), latest.replace(/^v/, "")) < 0;
}
