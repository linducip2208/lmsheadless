// Storage abstraction: local filesystem (dev) + Cloudflare R2 (production).
import type { AppEnv } from './types.js';

export interface StoredObject {
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  url?: string;
}

const ALLOWED_MIME: Record<string, string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  pdf: ['application/pdf'],
  document: [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/plain',
    'text/csv',
  ],
  video: ['video/mp4', 'video/webm'],
};

const ALLOWED_EXT = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'txt',
  'csv',
  'mp4',
  'webm',
]);

const MAX_SIZE = 25 * 1024 * 1024;

export function validateUpload(
  fileName: string,
  mimeType: string,
  sizeBytes: number,
  kind: 'image' | 'document' | 'video' | 'any' = 'any'
): string | null {
  if (sizeBytes <= 0 || sizeBytes > MAX_SIZE) return 'File size must be between 1 byte and 25MB';
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXT.has(ext)) return `Extension .${ext} is not allowed`;
  if (ext === 'exe' || ext === 'js' || ext === 'html') return 'Executable content is not allowed';
  if (kind !== 'any') {
    const allowed = ALLOWED_MIME[kind] ?? [];
    if (!allowed.includes(mimeType)) return `MIME type ${mimeType} is not allowed for ${kind}`;
  }
  if (mimeType.includes('html') || mimeType.includes('javascript') || mimeType.includes('x-sh')) {
    return 'Active content MIME types are not allowed';
  }
  return null;
}

// Magic-byte sniffing: extension/MIME claims are client-controlled, so verify
// the leading bytes for image/pdf/zip uploads. Returns the detected kind or
// null when the buffer matches none of the known signatures.
export function sniffKind(
  buf: ArrayBuffer
): 'png' | 'jpg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'exe' | null {
  const b = new Uint8Array(buf);
  if (b.length < 4) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'gif';
  if (
    b.length >= 12 &&
    b[0] === 0x52 &&
    b[1] === 0x49 &&
    b[2] === 0x46 &&
    b[3] === 0x46 &&
    b[8] === 0x57 &&
    b[9] === 0x45 &&
    b[10] === 0x42 &&
    b[11] === 0x50
  )
    return 'webp';
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
  if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07))
    return 'zip';
  // Executables: MZ (Windows), ELF (Linux), Mach-O (macOS), shebang scripts.
  if (b[0] === 0x4d && b[1] === 0x5a) return 'exe';
  if (b[0] === 0x7f && b[1] === 0x45 && b[2] === 0x4c && b[3] === 0x46) return 'exe';
  if (b[0] === 0xfe && b[1] === 0xed && b[2] === 0xfa && (b[3] === 0xce || b[3] === 0xcf))
    return 'exe';
  if (b[0] === 0xca && b[1] === 0xfe && b[2] === 0xba && b[3] === 0xbe) return 'exe';
  if (b[0] === 0x23 && b[1] === 0x21) return 'exe';
  return null;
}

// Cross-checks the file extension against sniffed magic bytes for types we
// can verify. Unknown/unverifiable types pass (extension allowlist still applies).
// Executable content (MZ/ELF/Mach-O/shebang) is rejected for every extension.
export function validateUploadBytes(buf: ArrayBuffer, fileName: string): string | null {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const kind = sniffKind(buf);
  if (!kind) return null;
  if (kind === 'exe') return 'Executable content is not allowed';
  const map: Record<string, string[]> = {
    png: ['png'],
    jpg: ['jpg', 'jpeg'],
    gif: ['gif'],
    webp: ['webp'],
    pdf: ['pdf'],
    zip: ['zip', 'h5p'],
  };
  const ok = map[kind] ?? [];
  if (ok.length && !ok.includes(ext)) return `File content (${kind}) does not match extension .${ext}`;
  return null;
}

// Zip-bomb guard: rejects archives whose unpacked size exceeds `ratio`
// times the archive size (highly compressible payloads aside, >100x is
// pathological). Call during extraction to abort early.
export function zipRatioExceeded(
  archiveBytes: number,
  unpackedBytes: number,
  ratio = 100
): boolean {
  if (archiveBytes <= 0) return true;
  return unpackedBytes > archiveBytes * ratio;
}

export function objectKey(prefix: string, fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? 'bin';
  const safe = ext.replace(/[^a-z0-9]/g, '').slice(0, 10) || 'bin';
  const d = new Date();
  const stamp = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${prefix}/${stamp}/${crypto.randomUUID()}.${safe}`;
}

export async function putObject(
  env: AppEnv,
  key: string,
  body: ArrayBuffer,
  contentType: string
): Promise<void> {
  if (env.STORAGE_DRIVER === 'r2' && env.R2) {
    await env.R2.put(key, body, { contentType });
    return;
  }
  const { mkdir, writeFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  // Prevent path traversal: key is always generated server-side, but double-check.
  if (key.includes('..') || key.startsWith('/')) throw new Error('Invalid object key');
  const full = join(env.STORAGE_LOCAL_DIR, key);
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(body));
}

export async function getObject(
  env: AppEnv,
  key: string
): Promise<{ body: ArrayBuffer; contentType: string } | null> {
  if (key.includes('..')) return null;
  if (env.STORAGE_DRIVER === 'r2' && env.R2) {
    const obj = await env.R2.get(key);
    if (!obj?.body) return null;
    const buf = await new Response(obj.body).arrayBuffer();
    return { body: buf, contentType: obj.contentType ?? 'application/octet-stream' };
  }
  try {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const full = join(env.STORAGE_LOCAL_DIR, key);
    const data = await readFile(full);
    return {
      body: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer,
      contentType: 'application/octet-stream',
    };
  } catch {
    return null;
  }
}
