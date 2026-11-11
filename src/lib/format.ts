export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes as number;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const formatted = value >= 10 ? value.toFixed(0) : value.toFixed(value >= 1 ? 1 : 2);
  return `${formatted} ${units[unit]}`;
}
