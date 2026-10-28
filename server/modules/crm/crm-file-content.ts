import axios from 'axios';
import { createHash } from 'node:crypto';
import { MAX_ATTACHMENT_BYTES, safeAttachmentUrl } from '@shared/crm-attachments';
const hashes = new Map<string, { hash: string; until: number }>();
export const hashBytes = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
/** Only called with a fresh attachment URL returned by the Base service. */
export async function readAttachmentBytes(url: string): Promise<Buffer> {
  if (!safeAttachmentUrl(url) || new URL(url).protocol !== 'https:') throw new Error('附件下载链接无效');
  const result = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer', timeout: 20000,
    maxContentLength: MAX_ATTACHMENT_BYTES, maxBodyLength: MAX_ATTACHMENT_BYTES, maxRedirects: 3 });
  return Buffer.from(result.data);
}
export async function attachmentContentHash(url: string): Promise<string> {
  const key = url;
  const cached = hashes.get(key);
  if (cached && cached.until > Date.now()) return cached.hash;
  const hash = hashBytes(await readAttachmentBytes(url));
  if (hashes.size >= 256) hashes.delete(hashes.keys().next().value!);
  hashes.set(key, { hash, until: Date.now() + 60000 });
  return hash;
}
