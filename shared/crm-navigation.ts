import type { CrmPage } from './api.interface';
import { appendPage } from './crm-interaction';

export interface RelatedPosition { depth: number }

/** Restore the loaded range with fresh records; a failed page leaves earlier progress intact. */
export async function readRelatedPages<T extends CrmPage>(options: {
  load: (cursor?: string) => Promise<T>;
  page: T | null;
  depth: number;
  targetDepth: number;
  canceled: () => boolean;
  onPage: (page: T, depth: number) => void;
}): Promise<void> {
  let page: T | null = options.page;
  let depth: number = options.depth;
  const cursors: Set<string> = new Set();
  while (depth < options.targetDepth && (!page || page.hasMore)) {
    if (options.canceled()) return;
    const cursor: string | undefined = page?.pageToken;
    if (page && (!cursor || cursors.has(cursor))) throw new Error('分页信息异常，请重新搜索或刷新后重试');
    if (cursor) cursors.add(cursor);
    const next: T = await options.load(cursor);
    if (options.canceled()) return;
    if (next.hasMore && (!next.pageToken || next.pageToken === cursor))
      throw new Error('分页信息异常，请重新搜索或刷新后重试');
    page = { ...next, ...appendPage(page, next),
      ...('sources' in next ? { sources: {
        ...(page && 'sources' in page ? page.sources as object : {}), ...next.sources as object,
      } } : {}),
    };
    depth++;
    options.onPage(page, depth);
  }
}
