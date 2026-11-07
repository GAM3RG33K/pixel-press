import { AlertTriangle } from "lucide-react";

import type { FallbackNotice } from "@/lib/ffmpeg/plan";

export function CodecFallbackNotice({
  notices,
}: {
  notices: FallbackNotice[];
}) {
  if (notices.length === 0) return null;

  return (
    <div
      role="status"
      className="mt-4 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm"
    >
      <p className="inline-flex items-center gap-1.5 font-medium text-warning">
        <AlertTriangle className="size-4 shrink-0" aria-hidden />
        Codec fallback
      </p>
      <ul className="mt-2 space-y-1 text-muted-foreground">
        {notices.map((notice) => (
          <li key={`${notice.requestedCodec}-${notice.actualCodec}-${notice.message}`}>
            {notice.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
