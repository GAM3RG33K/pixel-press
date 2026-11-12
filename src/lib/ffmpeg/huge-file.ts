/**
 * "Huge file" heuristic: files above this size get a slice probe (browser
 * picks) instead of a staged full probe, and docs treat them as disk-path
 * encode candidates. Threshold lowered to 500 MB and the ETA window to
 * 1 minute — large files on typical disks still pass through native probe.
 */
export function isHugeFile(f: { size: number }): boolean {
  return f.size > 500 * 1024 * 1024 || f.size > 150e6 * 60;
}
