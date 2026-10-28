import { textValue } from './crm';
import { attachments } from './crm-attachments';
import type { SavedAttachment } from './crm-attachments';
export const ATTACHMENT_METADATA = '附件元数据';
export interface AttachmentMetadata { name: string; nativeName: string; size: number; sha256: string }
export function attachmentMetadata(value: unknown): AttachmentMetadata[] {
  try {
    const parsed = JSON.parse(textValue(value));
    return parsed.version === 1 && Array.isArray(parsed.files) && parsed.files.every((f: AttachmentMetadata) =>
      typeof f.name === 'string' && typeof f.nativeName === 'string' && Number.isSafeInteger(f.size) &&
      f.size >= 0 && /^[a-f0-9]{64}$/.test(f.sha256)) ? parsed.files : [];
  } catch { return []; }
}
export function originalAttachmentNames(record: Record<string, unknown>, id: string): void {
  const metadata = [...attachmentMetadata(record[ATTACHMENT_METADATA])];
  if (!record['附件']) return;
  record['附件'] = attachments(record['附件']).map((file: SavedAttachment, index: number) => {
    const nativeName = file.nativeName || file.name;
    const match = metadata.findIndex(f => f.nativeName === nativeName && f.size === file.size);
    const name = match >= 0 ? metadata.splice(match, 1)[0].name : file.name;
    return { ...file, name, nativeName, downloadPath: `/api/crm/followups/${id}/attachments/${index}` };
  });
}
