import { useCallback, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  FolderOpen,
  Loader2,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  auditProjectFiles,
  type AuditReport,
} from "@/lib/audit";
import { diag, captureError } from "@/lib/diagnostics";
import { registerTask, updateTask, completeTask, failTask, cancelTask } from "@/lib/tasks/registry";
import { cn } from "@/lib/utils";

interface ScannedFile {
  filePath: string;
  contents: string;
}

export interface AuditViewProps {
  onSendToOptimize?: (report: AuditReport) => void;
}

export function AuditView({ onSendToOptimize }: AuditViewProps) {
  const [report, setReport] = useState<AuditReport | null>(null);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  const scanFiles = useCallback(async (incoming: File[]) => {
    const abortController = new AbortController();
    scanAbortRef.current = abortController;
    const signal = abortController.signal;
    const taskId = registerTask({
      workbench: "audit",
      label: "Audit · project scan",
      stage: "Reading files…",
      progress: 0,
      cancel: () => abortController.abort(),
    });
    setScanning(true);
    setStatus("Reading files…");
    try {
      const results: ScannedFile[] = [];
      for (const file of incoming) {
        if (signal.aborted) {
          cancelTask(taskId);
          throw new DOMException("Aborted", "AbortError");
        }
        // Only scan text-like sources
        if (/\.(png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|pdf|zip|gz|mp4|webm|mov|mkv|avi)$/i.test(file.name)) {
          continue;
        }
        const text = await file.text().catch(() => "");
        results.push({ filePath: file.webkitRelativePath || file.name, contents: text });
        updateTask(taskId, {
          progress: Math.round(((results.length) / Math.max(1, incoming.length)) * 100),
          stage: `Reading ${file.name}`,
        });
      }

      setStatus("Scanning for video tags…");
      updateTask(taskId, { progress: 100, stage: "Scanning for video tags…" });
      const audit = await auditProjectFiles(results);
      if (signal.aborted) {
        cancelTask(taskId);
        setScanning(false);
        setStatus(null);
        return;
      }
      setReport(audit);
      completeTask(taskId);
      setStatus(null);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") {
        setScanning(false);
        setStatus(null);
        return;
      }
      const normalized = captureError(caught);
      failTask(taskId, normalized.message);
      diag.error('audit', `scan failed: ${normalized.message}`, { stack: normalized.stack });
      setStatus(`Error: ${normalized.message}`);
    } finally {
      scanAbortRef.current = null;
      setScanning(false);
    }
  }, []);

  const openDirectory = useCallback(async () => {
    const picker = (window as unknown as {
      showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle>;
    }).showDirectoryPicker;

    if (picker) {
      try {
        setScanning(true);
        setStatus("Picking directory…");
        const handle = await picker();
        const collected: File[] = [];
        async function walk(dir: FileSystemDirectoryHandle, prefix: string) {
          for await (const [name, child] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
            if (child.kind === "file") {
              const file = await (child as FileSystemFileHandle).getFile();
              // @ts-expect-error – webkitRelativePath is read-only in TS lib
              file.webkitRelativePath = `${prefix}${name}`;
              collected.push(file);
            } else if (child.kind === "directory") {
              await walk(child as FileSystemDirectoryHandle, `${prefix}${name}/`);
            }
          }
        }
        await walk(handle, "");
        await scanFiles(collected);
        return;
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === "AbortError") {
          diag.info('audit', 'directory pick aborted by user');
          setScanning(false);
          setStatus(null);
          return;
        }
        const normalized = captureError(caught);
        diag.error('audit', `directory pick failed: ${normalized.message}`, { stack: normalized.stack });
        setStatus(`Error: ${normalized.message}`);
        setScanning(false);
        return;
      }
    }

    // Fallback: <input webkitdirectory>
    const input = document.getElementById("audit-directory-input") as HTMLInputElement | null;
    input?.click();
  }, [scanFiles]);

  const handleInputFiles = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const list = event.currentTarget.files;
      if (!list) return;
      scanFiles(Array.from(list));
    },
    [scanFiles],
  );

  const criticalCount = report?.files.reduce(
    (acc, file) => acc + file.findings.filter((f) => f.severity === "critical").length,
    0,
  ) ?? 0;

  return (
    <section aria-labelledby="audit-view" className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <h2 id="audit-view" className="text-lg font-semibold tracking-tight">
          Project Auditor
        </h2>
        <p className="text-sm text-muted-foreground">
          Drop your local project folder and find every &lt;video&gt; tag, missing poster, unmuted autoplay, or missing WebM fallback in your source code.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={openDirectory} disabled={scanning}>
            {scanning ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <FolderOpen className="size-4" aria-hidden />
            )}
            {scanning ? "Scanning…" : "Choose project folder"}
          </Button>
          <input
            id="audit-directory-input"
            type="file"
            // @ts-expect-error – webkitdirectory is non-standard but HTML standard
            webkitdirectory=""
            multiple
            className="sr-only"
            onChange={handleInputFiles}
          />
          {report ? (
            <p className="text-xs text-muted-foreground">
              Scanned {report.scannedFiles} files · {report.totalVideos} videos · {report.totalFindings} findings{criticalCount > 0 && ` · ${criticalCount} critical`}
            </p>
          ) : null}
        </div>

        {status ? (
          <p className="text-xs text-muted-foreground" role="status">{status}</p>
        ) : null}

        {report && report.totalVideos === 0 ? (
          <p className="rounded-xl border border-border bg-card/50 p-6 text-center text-sm text-muted-foreground backdrop-blur">
            <Search className="mx-auto mb-2 size-6" aria-hidden />
            No video tags found in this project. That is a valid result — scan &amp; optimize will skip nothing.
          </p>
        ) : null}

        {report && report.totalVideos > 0 ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm backdrop-blur">
              <div className="flex flex-wrap items-center gap-4">
                <ScoreStat label="Files" value={String(report.scannedFiles)} />
                <ScoreStat label="Videos" value={String(report.totalVideos)} />
                <ScoreStat label="Critical" value={String(criticalCount)} tone={criticalCount > 0 ? "critical" : "ok"} />
                <ScoreStat label="Findings" value={String(report.totalFindings)} tone={report.totalFindings > 0 ? "warn" : "ok"} />
              </div>
              {onSendToOptimize ? (
                <Button size="sm" variant="default" onClick={() => onSendToOptimize(report)}>
                  Optimize all flagged →
                </Button>
              ) : null}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-card/50 backdrop-blur">
              <div className="border-b border-border/60 px-4 py-2.5 text-sm font-medium">
                Audit scorecard
              </div>
              <div className="max-h-[520px] overflow-y-auto">
                {report.files.map((fileReport) => (
                  <details key={fileReport.filePath} className="group border-b border-border/40 last:border-0">
                    <summary className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-accent/40">
                      <FileCode2 className="size-4 text-info" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">{fileReport.filePath}</span>
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <CheckCircle2 className="size-3.5 text-success" aria-hidden />
                        {fileReport.videoTags} video(s)
                      </span>
                      <span className={cn(
                        "tabular-nums text-[11px]",
                        fileReport.findings.some((f) => f.severity === 'critical') ? "text-destructive" :
                        fileReport.findings.length > 0 ? "text-warning" : "text-success",
                      )}>
                        {fileReport.findings.length} finding{fileReport.findings.length === 1 ? "" : "s"}
                      </span>
                    </summary>
                    <ul className="space-y-2 border-t border-border/40 bg-card/30 px-4 py-3 text-xs">
                      {fileReport.findings.map((finding) => (
                        <li key={`${finding.filePath}-${finding.tagIndex}-${finding.ruleId}`} className="flex items-start gap-2">
                          <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", severityTone(finding.severity))} aria-hidden />
                          <div className="min-w-0">
                            <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{finding.ruleId.replace(/_/g, " ")}</p>
                            <p className="mt-0.5 leading-snug">{finding.message}</p>
                            <p className="mt-1 text-[10px] text-muted-foreground">line {finding.line}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">What this checks</h3>
          <ul className="mt-2 space-y-1.5">
            <li>· Autoplay without <code className="font-mono">muted</code> (critical)</li>
            <li>· Missing <code className="font-mono">playsinline</code> for iOS</li>
            <li>· Missing <code className="font-mono">preload="none|metadata"</code></li>
            <li>· Missing <code className="font-mono">poster</code></li>
            <li>· WebM/VP9 source missing</li>
            <li>· Audio track on a muted decoration</li>
          </ul>
          <p className="mt-3 leading-snug">
            Source text never leaves this device. File contents are scanned
            with a local regex engine, no uploads.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4 text-xs text-muted-foreground backdrop-blur">
          <h3 className="text-sm font-medium text-foreground">Scope limits</h3>
          <p className="mt-2 leading-snug">
            Audits source files only (.html/.jsx/.tsx/.vue/.svelte/.astro).
            Rendered-size heuristics from the upstream skill require a live
            URL, which the app does not access.
          </p>
        </div>
      </aside>
    </section>
  );
}

function severityTone(severity: string): string {
  switch (severity) {
    case "critical": return "text-destructive";
    case "warning": return "text-warning";
    default: return "text-info";
  }
}

function ScoreStat({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "ok" | "warn" | "critical" }) {
  const toneClass =
    tone === "critical"
      ? "text-destructive"
      : tone === "warn"
        ? "text-warning"
        : tone === "ok"
          ? "text-success"
          : "text-foreground";
  return (
    <div className="flex flex-col">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-lg font-semibold tabular-nums leading-none", toneClass)}>{value}</span>
    </div>
  );
}
