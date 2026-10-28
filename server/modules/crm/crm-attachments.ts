import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { attachmentRef, attachments, safeAttachmentUrl, MAX_ATTACHMENT_BYTES } from '@shared/crm-attachments';
import { reject } from './crm-validation';
import { hashBytes } from './crm-file-content';
import type { AttachmentMetadata } from '@shared/crm-attachment-metadata';
export interface ExpectedAttachment { name: string; size: number; storageName?: string; sha256?: string }

/** Only resolve app storage paths or attachments already on this record, never caller-supplied URLs. */
export async function resolveAttachments(values: string[], previous: unknown, files: Pick<FileService, 'getFileMetadata' | 'createSignedUrl'> & Partial<Pick<FileService, 'download'>>,
  readHash?: (url: string) => Promise<string>) {
  const existing = attachments(previous);
  const urls: string[] = [];
  const expected: ExpectedAttachment[] = [];
  const used = new Set<string>();
  for (const raw of values) {
    const ref = attachmentRef(raw);
    const key = ref.source === 'existing' ? `existing:${ref.index}` : `upload:${ref.path}`;
    if (used.has(key)) reject('附件', '不能重复添加同一文件');
    used.add(key);
    if (ref.source === 'existing') {
      const file = existing[ref.index!];
      if (!file || file.name !== ref.name || file.size !== ref.size || file.type !== ref.mime) reject('附件', '文件已变化，请刷新后重试');
      if (!safeAttachmentUrl(file.tmpUrl)) reject('附件', '下载链接无效，请刷新后重试');
      urls.push(file.tmpUrl); expected.push({ name: file.name, size: file.size,
        ...(readHash ? { sha256: await readHash(file.tmpUrl) } : {}) });
    } else {
      const file = await files.getFileMetadata(ref.path!);
      const size = Number(file?.metadata.contentLength);
      if (!file || file.name !== ref.name || !Number.isSafeInteger(size) || size !== ref.size || size > MAX_ATTACHMENT_BYTES)
        reject('附件', '文件校验失败，请重新上传');
      const url = await files.createSignedUrl(ref.path!, 3600);
      if (!safeAttachmentUrl(url)) reject('附件', '文件链接生成失败，请重试');
      // Base imports URL attachments using their storage object basename. It can
      // differ from the original upload name returned by getFileMetadata.
      const storageName = ref.path!.split('/').at(-1)!;
      let sha256: string | undefined;
      if (readHash) {
        if (!files.download) reject('附件', '文件服务不支持内容校验');
        const downloaded = await files.download(ref.path!);
        if (downloaded.content.size !== size) reject('附件', '上传文件内容大小不一致');
        sha256 = hashBytes(new Uint8Array(await downloaded.content.arrayBuffer()));
      }
      urls.push(url); expected.push({ name: file.name, size, storageName, ...(sha256 ? { sha256 } : {}) });
    }
  }
  return { urls, expected };
}

/** Base may reuse a file token and name from an earlier identical upload. */
export async function verifyAttachmentContent(actual: unknown, expected: ExpectedAttachment[], readHash: (url: string) => Promise<string>): Promise<AttachmentMetadata[]> {
  const saved = attachments(actual);
  if (saved.length !== expected.length) throw new Error('附件数量不一致');
  const unused = [...expected];
  const result: AttachmentMetadata[] = [];
  for (const file of saved) {
    const sha256 = await readHash(file.tmpUrl);
    const index = unused.findIndex(v => v.size === file.size && v.sha256 === sha256);
    if (index < 0) throw new Error('附件内容不一致');
    const matched = unused.splice(index, 1)[0];
    result.push({ name: matched.name, nativeName: file.nativeName || file.name, size: file.size, sha256 });
  }
  return result;
}

export function attachmentWriteMatches(actual: unknown, expected: ExpectedAttachment[]): boolean {
  try {
    const saved = attachments(actual);
    if (saved.length !== expected.length) return false;
    // One-to-one matching preserves duplicate counts even when a storage name
    // collides with another file's original name. Size alone is never sufficient.
    const assigned: number[] = Array(saved.length).fill(-1);
    const match = (index: number, seen: Set<number>): boolean => {
      const file = expected[index];
      for (let i = 0; i < saved.length; i++) {
        if (seen.has(i) || saved[i].size !== file.size ||
          (saved[i].name !== file.name && saved[i].name !== file.storageName)) continue;
        seen.add(i);
        if (assigned[i] < 0 || match(assigned[i], seen)) { assigned[i] = index; return true; }
      }
      return false;
    };
    return expected.every((_, index) => match(index, new Set()));
  } catch { return false; }
}
