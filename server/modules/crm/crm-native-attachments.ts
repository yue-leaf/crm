import axios from 'axios';
import { BadRequestException, BadGatewayException, ConflictException } from '@nestjs/common';
import type { FileService } from '@lark-apaas/fullstack-nestjs-core';
import { attachmentRef, attachments } from '@shared/crm-attachments';
import type { ExpectedAttachment } from './crm-attachments';

interface NativeFile { file_token: string; name: string; size: number }
export interface NativeAttachmentPlan {
  base: string; table: string; tokens: string[]; expected: ExpectedAttachment[];
}
interface ApiResult {
  code?: number;
  data?: { file_token?: string; record?: { fields?: Record<string, unknown> } };
}
type NativeRequest = (method: string, path: string, data?: unknown, token?: string) => Promise<ApiResult>;
const nativeRequest: NativeRequest = async (method, path, data, token) => {
  const response = await axios.request<ApiResult>({ method, url: `https://base-api.feishu.cn/open-apis${path}`,
    data, headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    timeout: 30000, maxBodyLength: 22 * 1024 * 1024, maxRedirects: 0 });
  return response.data;
};

/** Use native media uploads: the filename is a multipart field, never inferred from a URL. */
export class NativeAttachmentGateway {
  constructor(private readonly request: NativeRequest = nativeRequest,
    private readonly config: () => { personalBaseToken?: string } = () => ({
      personalBaseToken: process.env.FEISHU_BASE_PERSONAL_TOKEN,
    })) {}

  private async token(): Promise<string> {
    const token = this.config().personalBaseToken?.trim();
    if (!token) throw new BadRequestException('附件上传尚未配置多维表格授权码，请联系管理员；记录尚未保存');
    return token;
  }
  private path(base: string, table: string, id?: string): string {
    if (!/^[A-Za-z0-9]+$/.test(base) || !/^tbl[A-Za-z0-9]+$/.test(table) || (id && !/^rec[A-Za-z0-9]+$/.test(id)))
      throw new BadRequestException('附件目标配置无效');
    return `/bitable/v1/apps/${base}/tables/${table}${id ? `/records/${id}` : ''}`;
  }
  private async read(base: string, table: string, id: string, token: string): Promise<NativeFile[]> {
    const result = await this.request('GET', this.path(base, table, id), undefined, token);
    if (result.code !== 0 || !result.data?.record?.fields) throw new Error('record inaccessible');
    const values = result.data.record.fields['附件'] ?? [];
    if (!Array.isArray(values) || values.some(v => !v || typeof v.file_token !== 'string' ||
      typeof v.name !== 'string' || !Number.isSafeInteger(v.size))) throw new Error('invalid attachments');
    return values as NativeFile[];
  }
  async prepare(base: string, table: string, values: string[], previous: unknown,
    files: Pick<FileService, 'getFileMetadata' | 'download'>, id?: string): Promise<NativeAttachmentPlan> {
    const refs = values.map(attachmentRef);
    const token = await this.token();
    const expected: ExpectedAttachment[] = [], tokens: string[] = [];
    try {
      // Validate access before any CRM business write (including new records).
      const access = await this.request('GET', this.path(base, table), undefined, token);
      if (access.code !== 0) throw new Error('table inaccessible');
      const native = id ? await this.read(base, table, id, token) : [];
      const old = attachments(previous);
      const used = new Set<string>();
      for (const ref of refs) {
        const key = ref.source === 'existing' ? `existing:${ref.index}` : `upload:${ref.path}`;
        if (used.has(key)) throw new BadRequestException('附件不能重复添加');
        used.add(key);
        if (ref.source === 'existing') {
          const item = old[ref.index!];
          if (!item || item.name !== ref.name || item.size !== ref.size || item.type !== ref.mime)
            throw new ConflictException('附件已变化，请刷新后重试');
          const index = native.findIndex(v => v.name === ref.name && v.size === ref.size);
          if (index < 0) throw new ConflictException('附件已变化，请刷新后重试');
          tokens.push(native.splice(index, 1)[0].file_token);
        } else {
          const meta = await files.getFileMetadata(ref.path!);
          if (!meta || meta.name !== ref.name || Number(meta.metadata.contentLength) !== ref.size)
            throw new BadRequestException('附件信息不一致，请重新上传');
          const downloaded = await files.download(ref.path!);
          if (downloaded.content.size !== ref.size) throw new BadRequestException('附件内容不完整，请重新上传');
          const form = new FormData();
          form.append('file_name', meta.name);
          form.append('parent_type', 'bitable_file');
          form.append('parent_node', base);
          form.append('size', String(ref.size));
          form.append('file', downloaded.content, meta.name);
          const result = await this.request('POST', '/drive/v1/medias/upload_all', form, token);
          if (result.code !== 0 || !result.data?.file_token) throw new Error('native upload failed');
          tokens.push(result.data.file_token);
        }
        expected.push({ name: ref.name, size: ref.size });
      }
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException) throw error;
      throw new BadRequestException('附件上传失败，请检查多维表格授权码是否启用及其访问权限；记录尚未保存');
    }
    return { base, table, tokens, expected };
  }
  async apply(plan: NativeAttachmentPlan, id: string): Promise<void> {
    try {
      const token = await this.token();
      const result = await this.request('PUT', this.path(plan.base, plan.table, id),
        { fields: { 附件: plan.tokens.map(file_token => ({ file_token })) } }, token);
      if (result.code !== 0) throw new Error('attachment write failed');
      const saved = await this.read(plan.base, plan.table, id, token);
      if (saved.length !== plan.tokens.length || plan.tokens.some(t => !saved.some(f => f.file_token === t)) ||
          plan.expected.some((file, index) => !saved.some(f => f.file_token === plan.tokens[index] &&
            f.name === file.name && f.size === file.size)))
        throw new Error('attachment tokens mismatch');
    } catch { throw new BadGatewayException(`记录 ${id} 已保存，附件写入尚未确认，请刷新核对，避免重复提交`); }
  }
}
