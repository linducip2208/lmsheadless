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
