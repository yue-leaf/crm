import { useCallback, useEffect, useRef, useState } from 'react';
import type { CrmPage } from '@shared/api.interface';
import { appendPage } from '@shared/crm-interaction';
import { message } from './Fields';

export function useRelatedPage<T extends CrmPage>(load: (cursor?: string) => Promise<T>) {
  const [page, setPage] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  useEffect(() => {
    const request: number = ++generation.current;
    paging.current = false;
    setPage(null); setError(''); setLoading(true);
    void load().then((next: T) => { if (request === generation.current) setPage(next); })
      .catch((e: unknown) => { if (request === generation.current) setError(message(e)); })
      .finally(() => { if (request === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [load, retryVersion]);
  const more = useCallback(async () => {
    if (paging.current || !page?.hasMore || !page.pageToken) return;
    const request: number = generation.current;
    paging.current = true; setLoading(true); setError('');
    try {
      const next: T = await load(page.pageToken);
      if (request === generation.current) setPage((before: T | null) => ({ ...next,
        ...appendPage(before, next),
        ...('sources' in next ? { sources: { ...(before && 'sources' in before ? before.sources as object : {}), ...next.sources as object } } : {}),
      }));
    } catch (e: unknown) { if (request === generation.current) setError(message(e)); }
    finally { if (request === generation.current) { paging.current = false; setLoading(false); } }
  }, [page, load]);
  return { page, loading, error, more, retry: () => setRetryVersion((version: number) => version + 1) };
}
