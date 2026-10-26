import React, { useEffect, useState } from 'react';
import { api } from '@/api/crm';
import { Button } from '@/components/ui/button';
import { textValue, titles, labels } from '@shared/crm';
import type { EntityKind } from '@shared/api.interface';

interface ContactNameState {
  id: string;
  name: string;
  disabled: boolean;
  failed: boolean;
}

/** Resolve the linked record itself so historical, disabled contacts remain visible. */
export const ContactName: React.FC<{ id: string; kind?: EntityKind; onOpen?: () => void }> = ({ id, kind = 'contact', onOpen }) => {
  const [state, setState] = useState<ContactNameState | null>(null);
  const [retry, setRetry] = useState<number>(0);
  useEffect(() => {
    let canceled: boolean = false;
    setState(null);
    void api.get(kind, id).then((row) => {
      if (canceled) return;
      setState({
        id,
        name: textValue(row.record[titles[kind]]) || `未命名${labels[kind]}`,
        disabled: textValue(row.record['联系人状态']) === '停用',
        failed: false,
      });
    }).catch(() => {
      if (!canceled) setState({ id, name: '', disabled: false, failed: true });
    });
    return () => { canceled = true; };
  }, [id, kind, retry]);

  if (!state || state.id !== id) return <span className="muted">加载{labels[kind]}…</span>;
  if (state.failed) return <span className="inline-flex flex-wrap items-center gap-1">
    <span className="muted">{labels[kind]}加载失败</span>
    <Button type="button" variant="ghost" size="sm" onClick={() => setRetry((n: number) => n + 1)}>
      重试
    </Button>
  </span>;
  const content = <>{state.name}{state.disabled && <span className="muted">（已停用）</span>}</>;
  return onOpen ? <button type="button" className="record-title break-words" onClick={onOpen}>{content}</button>
    : <span className="break-words">{content}</span>;
};
