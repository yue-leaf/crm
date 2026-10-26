import React, { useEffect, useState } from 'react';
import { api } from '@/api/crm';
import { Button } from '@/components/ui/button';
import { textValue } from '@shared/crm';

interface ContactNameState {
  id: string;
  name: string;
  disabled: boolean;
  failed: boolean;
}

/** Resolve the linked record itself so historical, disabled contacts remain visible. */
export const ContactName: React.FC<{ id: string }> = ({ id }) => {
  const [state, setState] = useState<ContactNameState | null>(null);
  const [retry, setRetry] = useState<number>(0);
  useEffect(() => {
    let canceled: boolean = false;
    setState(null);
    void api.get('contact', id).then((row) => {
      if (canceled) return;
      setState({
        id,
        name: textValue(row.record['姓名']) || '未命名联系人',
        disabled: textValue(row.record['联系人状态']) === '停用',
        failed: false,
      });
    }).catch(() => {
      if (!canceled) setState({ id, name: '', disabled: false, failed: true });
    });
    return () => { canceled = true; };
  }, [id, retry]);

  if (!state || state.id !== id) return <span className="muted">加载联系人…</span>;
  if (state.failed) return <span className="inline-flex flex-wrap items-center gap-1">
    <span className="muted">联系人加载失败</span>
    <Button type="button" variant="ghost" size="sm" onClick={() => setRetry((n: number) => n + 1)}>
      重试
    </Button>
  </span>;
  return <span className="break-words">{state.name}{state.disabled && <span className="muted">（已停用）</span>}</span>;
};
