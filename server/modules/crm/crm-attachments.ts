import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { attachmentRef, attachments, safeAttachmentUrl, MAX_ATTACHMENT_BYTES } from '@shared/crm-attachments';
import { reject } from './crm-validation';

/** Only resolve app storage paths or attachments already on this record, never caller-supplied URLs. */
export async function resolveAttachments(values: string[], previous: unknown, files: Pick<FileService, 'getFileMetadata' | 'createSignedUrl'>) {
  const existing = attachments(previous);
  const urls: string[] = [];
  const expected: { name: string; size: number }[] = [];
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
      urls.push(file.tmpUrl); expected.push({ name: file.name, size: file.size });
    } else {
      const file = await files.getFileMetadata(ref.path!);
      const size = Number(file?.metadata.contentLength);
      if (!file || file.name !== ref.name || !Number.isSafeInteger(size) || size !== ref.size || size > MAX_ATTACHMENT_BYTES)
        reject('附件', '文件校验失败，请重新上传');
      const url = await files.createSignedUrl(ref.path!, 3600);
      if (!safeAttachmentUrl(url)) reject('附件', '文件链接生成失败，请重试');
      urls.push(url); expected.push({ name: file.name, size });
    }
  }
  return { urls, expected };
}

export function attachmentWriteMatches(actual: unknown, expected: { name: string; size: number }[]): boolean {
  const signature = (rows: { name: string; size: number }[]) => JSON.stringify(rows.map(v => [v.name, v.size]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  try { return signature(attachments(actual)) === signature(expected); } catch { return false; }
}
