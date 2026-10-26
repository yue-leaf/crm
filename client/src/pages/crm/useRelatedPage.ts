import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { CrmPage } from '@shared/api.interface';
import { readRelatedPages } from '@shared/crm-navigation';
import { RelatedPageMemory } from './RelatedPageMemory';
import { message } from './Fields';

export function useRelatedPage<T extends CrmPage>(load: (cursor?: string) => Promise<T>, key: string) {
  const memory = useContext(RelatedPageMemory);
  const [page, setPage] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retryVersion, setRetryVersion] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  const progress = useRef<{ page: T | null; depth: number; target: number }>({ page: null, depth: 0, target: 1 });
  const read = useCallback(async (request: number) => {
    paging.current = true; setLoading(true); setError('');
    try {
      await readRelatedPages({ load, page: progress.current.page, depth: progress.current.depth,
        targetDepth: progress.current.target, canceled: () => request !== generation.current,
        onPage: (next: T, depth: number) => {
          progress.current.page = next; progress.current.depth = depth; setPage(next);
          memory?.set(key, { depth: next.hasMore ? Math.max(depth, progress.current.target) : depth });
        },
      });
    } catch (e: unknown) { if (request === generation.current) setError(message(e)); }
    finally { if (request === generation.current) { paging.current = false; setLoading(false); } }
  }, [key, load, memory]);
  useEffect(() => {
    const request: number = ++generation.current;
    progress.current = { page: null, depth: 0, target: memory?.get(key)?.depth || 1 };
    setPage(null);
    void read(request);
    return () => { generation.current++; };
  }, [key, memory, read, retryVersion]);
  const more = () => {
    if (paging.current || !progress.current.page?.hasMore) return;
    progress.current.target = Math.max(progress.current.target, progress.current.depth + 1);
    void read(generation.current);
  };
  const refresh = () => setRetryVersion((version: number) => version + 1);
  // A failed next page must retry the same cursor, preserving the records already read.
  const retry = () => { if (!paging.current) void read(generation.current); };
  return { page, loading, error, more, retry, refresh };
}
