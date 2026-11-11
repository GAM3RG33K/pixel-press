export function isHugeFile(f: { size: number }): boolean {
  return f.size > 2 * 1024 * 1024 * 1024 || f.size > 150e6 * 120;
}
