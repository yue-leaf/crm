import React, { useRef, useState } from 'react';
import { Paperclip, Upload, X, LoaderCircle } from 'lucide-react';
import { getDataloom } from '@lark-apaas/client-toolkit/dataloom';
import { getDefaultBucketId } from '@lark-apaas/client-toolkit/tools/storage';
import { Button } from '@/components/ui/button';
import { attachments, attachmentRef, fileSize, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, safeAttachmentUrl } from '@shared/crm-attachments';
import type { AttachmentRef } from '@shared/crm-attachments';
import './attachments.css';

export const AttachmentList: React.FC<{ value: unknown }> = ({ value }) => {
  try {
    const files = attachments(value);
    return files.length ? <ul className="attachment-list">{files.map((file, index) => <li key={index}>
      <Paperclip size={16} /><span className="attachment-name">{safeAttachmentUrl(file.tmpUrl)
        ? <a href={file.tmpUrl} target="_blank" rel="noopener noreferrer">{file.name}</a> : file.name}</span>
      <small>{fileSize(file.size)}</small>
    </li>)}</ul> : <span className="muted">—</span>;
  } catch { return <span role="alert">附件加载失败，请刷新</span>; }
};

export const AttachmentField: React.FC<{ value: string[]; onChange: (value: string[]) => void; disabled?: boolean;
  onBusy?: (busy: boolean) => void }> = ({ value, onChange, disabled, onBusy }) => {
  const input = useRef<HTMLInputElement>(null);
  const lock = useRef(false);
  const [uploading, setUploading] = useState('');
  const [error, setError] = useState('');
  const upload = async (selected: File[]) => {
    if (lock.current || disabled || !selected.length) return;
    if (value.length + selected.length > MAX_ATTACHMENTS) { setError(`最多上传 ${MAX_ATTACHMENTS} 个文件`); return; }
    if (selected.some(file => file.size > MAX_ATTACHMENT_BYTES)) { setError('单个文件不能超过 20 MB'); return; }
    lock.current = true; onBusy?.(true); setError('');
    const next = [...value];
    const failed: string[] = [];
    try {
      const storage = (await getDataloom()).storage.from(getDefaultBucketId());
      for (const file of selected) {
        setUploading(file.name);
        try {
          const { data, error: failure } = await storage.uploadFile(file, { contentType: file.type || 'application/octet-stream' });
          if (failure || !data?.file_path) throw new Error('上传失败');
          const ref: AttachmentRef = { source: 'upload', name: file.name, size: file.size, path: data.file_path };
          const encoded = JSON.stringify(ref);
          attachmentRef(encoded);
          next.push(encoded); onChange([...next]);
        } catch { failed.push(file.name); }
      }
      if (failed.length) setError(`上传失败：${failed.join('、')}。请重新选择这些文件。`);
    } catch { setError('文件服务暂不可用，请重试'); }
    finally { lock.current = false; setUploading(''); onBusy?.(false); }
  };
  return <div className="attachment-field" aria-busy={Boolean(uploading)}>
    <ul className="attachment-list">{value.map((raw, index) => {
      const file = attachmentRef(raw);
      return <li key={raw}><Paperclip size={16} /><span className="attachment-name">{file.name}</span>
        <small>{fileSize(file.size)}</small><Button type="button" variant="ghost" size="sm" aria-label={`移除${file.name}`}
          disabled={disabled || Boolean(uploading)} onClick={() => onChange(value.filter((_, i) => i !== index))}><X size={15} /></Button></li>;
    })}</ul>
    <input ref={input} type="file" multiple className="sr-only" tabIndex={-1} aria-label="选择附件" disabled={disabled || Boolean(uploading)}
      onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void upload(files); }} />
    <div className="attachment-toolbar"><Button type="button" variant="outline" size="sm" disabled={disabled || Boolean(uploading) || value.length >= MAX_ATTACHMENTS}
      onClick={() => input.current?.click()}>{uploading ? <LoaderCircle size={15} className="spin" /> : <Upload size={15} />}{uploading ? '正在上传' : '上传文件'}</Button>
      <small>最多 20 个，单个不超过 20 MB</small></div>
    {uploading && <p className="muted attachment-name" role="status">{uploading}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </div>;
};
