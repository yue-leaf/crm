export const MAX_ATTACHMENTS = 20;
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export interface SavedAttachment { name: string; size: number; type: string; tmpUrl: string }
export interface AttachmentRef { source: 'existing' | 'upload'; name: string; size: number; index?: number; path?: string; mime?: string }

/** Keep the original basename; use a separate directory to prevent overwrites. */
export function attachmentUploadPath(name: string, uniqueId: string): string {
  if (!name.trim() || name === '.' || name === '..' || /[\\/\x00-\x1f?:]/.test(name) ||
      !/^[A-Za-z0-9-]+$/.test(uniqueId)) throw new Error('文件名含不支持的字符，请重命名后上传');
  return `followups/${uniqueId}/${name}`;
}

export function attachments(value: unknown): SavedAttachment[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.some(v => !v || typeof v !== 'object' ||
    typeof v.name !== 'string' || typeof v.size !== 'number' || typeof v.tmpUrl !== 'string' || typeof v.type !== 'string'))
    throw new Error('附件信息异常，请刷新后重试');
  return value as SavedAttachment[];
}
export function attachmentDraft(value: unknown): string[] {
  return attachments(value).map((v, index) => JSON.stringify({ source: 'existing', index, name: v.name, size: v.size, mime: v.type }));
}
export function attachmentRef(value: string): AttachmentRef {
  const v = JSON.parse(value) as AttachmentRef;
  if (!v || !['existing', 'upload'].includes(v.source) || typeof v.name !== 'string' || !v.name.trim() || v.name.length > 1024 ||
    typeof v.size !== 'number' || !Number.isSafeInteger(v.size) || v.size < 0 ||
    (v.source === 'existing' && (!Number.isInteger(v.index) || v.index! < 0 || typeof v.mime !== 'string')) ||
    (v.source === 'upload' && (v.size > MAX_ATTACHMENT_BYTES || typeof v.path !== 'string' || !v.path || v.path.length > 2048 ||
      /[\\\x00-\x1f?:]/.test(v.path) || v.path.startsWith('/') || v.path.split('/').some(p => !p || p === '.' || p === '..'))))
    throw new Error('附件信息无效，请重新选择文件');
  return v;
}
export function attachmentSignature(value: unknown): string {
  return JSON.stringify(attachments(value).map(v => [v.name, v.size, v.type]).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
}
export function safeAttachmentUrl(value: string): string | undefined {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? value : undefined; }
  catch { return undefined; }
}
export function fileSize(bytes: number): string {
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
