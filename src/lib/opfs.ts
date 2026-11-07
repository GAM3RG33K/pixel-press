/**
 * Origin Private File System (OPFS) helper utilities.
 * Provides type-safe wrappers for File System Access API operations.
 */

export const OPFS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface OpfsEntry {
  path: string;
  kind: "file" | "directory";
  size: number;
  lastModified: number;
}

export function isOpfsSupported(): boolean {
  return typeof navigator !== "undefined" && !!navigator.storage?.getDirectory;
}

export function normalizeOpfsPath(path: string): string {
  const trimmed = path.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";

  const segments = trimmed.split("/").filter((s) => s !== "");

  for (const segment of segments) {
    if (segment === "." || segment === ".." || segment.includes("\\")) {
      throw new Error("Invalid OPFS path");
    }
    if (segment === "") {
      throw new Error("Invalid OPFS path");
    }
  }

  return segments.join("/");
}

export async function getOpfsRoot(): Promise<FileSystemDirectoryHandle> {
  if (!isOpfsSupported()) {
    throw new Error("OPFS is not supported");
  }
  return navigator.storage.getDirectory();
}

export async function ensureOpfsDir(path: string): Promise<FileSystemDirectoryHandle> {
  const normalized = normalizeOpfsPath(path);
  const root = await getOpfsRoot();

  if (normalized === "") {
    return root;
  }

  const segments = normalized.split("/");
  let current = root;

  for (const segment of segments) {
    current = await current.getDirectoryHandle(segment, { create: true });
  }

  return current;
}

export async function writeOpfsFile(
  path: string,
  data: Blob | BufferSource | string,
): Promise<void> {
  const normalized = normalizeOpfsPath(path);
  const segments = normalized.split("/").filter((s) => s !== "");
  const fileName = segments.pop() ?? "";
  if (fileName === "") {
    throw new Error("Invalid OPFS path");
  }
  const parentPath = segments.join("/");

  const parentDir = await ensureOpfsDir(parentPath);
  const fileHandle = await parentDir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

export async function readOpfsFile(path: string): Promise<File> {
  const normalized = normalizeOpfsPath(path);
  const segments = normalized.split("/").filter((s) => s !== "");
  const fileName = segments.pop() ?? "";
  if (fileName === "") {
    throw new Error("Invalid OPFS path");
  }
  const parentPath = segments.join("/");

  const parentDir = await ensureOpfsDir(parentPath);
  const fileHandle = await parentDir.getFileHandle(fileName);
  return fileHandle.getFile();
}

export async function deleteOpfsEntry(path: string): Promise<void> {
  const normalized = normalizeOpfsPath(path);
  const segments = normalized.split("/").filter((s) => s !== "");

  if (segments.length === 0) {
    return;
  }

  const root = await getOpfsRoot();
  const fileName = segments.pop() ?? "";
  if (fileName === "") {
    return;
  }

  // Walk to the parent without creating missing directories.
  let parentDir = root;
  for (const segment of segments) {
    try {
      parentDir = await parentDir.getDirectoryHandle(segment);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotFoundError") {
        return;
      }
      throw e;
    }
  }

  try {
    await parentDir.removeEntry(fileName, { recursive: true });
  } catch (e) {
    if (e instanceof DOMException && e.name === "NotFoundError") {
      return;
    }
    throw e;
  }
}

export async function listOpfsEntries(dirPath = ""): Promise<OpfsEntry[]> {
  const normalized = normalizeOpfsPath(dirPath);
  const root = await getOpfsRoot();

  const startDir = normalized === "" ? root : await ensureOpfsDir(normalized);
  const entries: OpfsEntry[] = [];

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    for await (const [name, handle] of (dir as FileSystemDirectoryHandle & { entries(): AsyncIterableIterator<[string, FileSystemHandle]> }).entries()) {
      const fullPath = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === "file") {
        const fileHandle = handle as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        entries.push({
          path: fullPath,
          kind: "file",
          size: file.size,
          lastModified: file.lastModified,
        });
      } else if (handle.kind === "directory") {
        const dirHandle = handle as FileSystemDirectoryHandle;
        entries.push({
          path: fullPath,
          kind: "directory",
          size: 0,
          lastModified: 0,
        });
        await walk(dirHandle, fullPath);
      }
    }
  }

  await walk(startDir, normalized);
  return entries;
}

export async function cleanupOpfsOlderThan(maxAgeMs: number): Promise<number> {
  if (!isOpfsSupported()) {
    return 0;
  }

  let deletedCount = 0;
  const threshold = Date.now() - maxAgeMs;

  try {
    const allEntries = await listOpfsEntries("");
    const sortedEntries = allEntries.sort((a, b) => b.path.split("/").length - a.path.split("/").length);

    const deletedPaths = new Set<string>();

    for (const entry of sortedEntries) {
      if (entry.lastModified === 0 && entry.kind === "directory") {
        continue;
      }

      if (entry.lastModified >= threshold) {
        continue;
      }

      const isUnderDeleted = [...deletedPaths].some(
        (p) => entry.path === p || entry.path.startsWith(p + "/"),
      );
      if (isUnderDeleted) {
        continue;
      }

      await deleteOpfsEntry(entry.path);
      deletedCount++;
      deletedPaths.add(entry.path);
    }
  } catch {
    return deletedCount;
  }

  return deletedCount;
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number }> {
  if (!isOpfsSupported()) {
    return { usage: 0, quota: 0 };
  }
  const estimate = await navigator.storage.estimate();
  return {
    usage: estimate.usage ?? 0,
    quota: estimate.quota ?? 0,
  };
}