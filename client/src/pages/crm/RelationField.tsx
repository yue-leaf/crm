import React, { useEffect, useRef, useState } from 'react';
import { api } from '@/api/crm';
import type { CrmRecord } from '@shared/api.interface';
import type { FieldSpec } from '@shared/crm';
import { titles, textValue } from '@shared/crm';
import { RecordPicker } from './RecordPicker';
import type { RecordOption } from './RecordPicker';
import { contactChoiceProblem } from '@shared/crm-ux';
import { Button } from '@/components/ui/button';

const errorText = (error: unknown) => error instanceof Error ? error.message : '数据加载失败，请重试';
export const RelationField: React.FC<{
  field: FieldSpec;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  customerId?: string;
  occurredAt?: number;
  onCreateContact?: () => void;
}> = ({ field, value, onChange, disabled, customerId, occurredAt, onCreateContact }) => {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<CrmRecord[]>([]);
  const [known, setKnown] = useState<CrmRecord[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string>();
  const [error, setError] = useState('');
  const [selectionError, setSelectionError] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);
  const selectedIds = value.join('|');
  useEffect(() => {
    let canceled = false;
    if (!field.target || !selectedIds) { setSelectionError(''); return; }
    const target = field.target;
    setSelectionError('');
    const missing = selectedIds.split('|').filter((id) => !known.some((row) => row.id === id));
    if (!missing.length) return;
    void Promise.allSettled(missing.map((id) => api.get(target, id))).then((results) => {
      if (canceled) return;
      const rows = results.flatMap((r) => r.status === 'fulfilled' ? [r.value] : []);
      setKnown((prev) => [...new Map([...prev, ...rows].map((row) => [row.id, row])).values()]);
      if (results.some((r) => r.status === 'rejected')) setSelectionError('部分已选记录名称加载失败，请重新打开选择框后重试');
    });
    return () => { canceled = true; };
  }, [field.target, selectedIds, retry]);

  useEffect(() => {
    const version = ++generation.current;
    paging.current = false;
    setLoadingMore(false);
    setCursor(undefined);
    setItems([]);
    setError('');
    setLoading(open && !disabled);
    if (!open || disabled || !field.target) return;
    const target = field.target;
    const timer = setTimeout(() => {
      void (target === 'contact' && customerId ? api.customerContacts(customerId, { search: query })
        : target === 'project' && customerId ? api.customerProjects(customerId, { search: query })
        : api.list(target, '', query)).then((result) => {
        if (version !== generation.current) return;
        setItems(result.records);
        setKnown((prev) => [...new Map([...prev, ...result.records].map((row) => [row.id, row])).values()]);
        setCursor(result.hasMore ? result.pageToken : undefined);
      }).catch((e: unknown) => {
        if (version === generation.current) setError(errorText(e));
      }).finally(() => { if (version === generation.current) setLoading(false); });
    }, query ? 250 : 0);
    return () => { generation.current++; clearTimeout(timer); };
  }, [field.target, customerId, query, open, disabled, retry]);

  const option = (row: CrmRecord): RecordOption => ({
    id: row.id, name: textValue(row.record[titles[field.target!]]) || '未命名记录',
    ...(field.target === 'contact' ? {
      description: [textValue(row.record['职务']), textValue(row.record['电话']) || textValue(row.record['邮箱']),
        textValue(row.record['联系人状态']) === '停用' ? '已停用' : ''].filter(Boolean).join(' · '),
      disabledReason: contactChoiceProblem(row, occurredAt ?? NaN),
    } : {}),
  });
  return <div className="relation-field">
    <RecordPicker label={field.label || field.key} multiple={field.multiple} disabled={disabled}
      value={value} selected={known.filter((row) => value.includes(row.id)).map(option)} options={items.map(option)}
      open={open} onOpenChange={(next) => { generation.current++; setOpen(next); if (!next) setQuery(''); }}
      query={query} onQueryChange={(next) => { if (next === query) return; generation.current++; setItems([]); setCursor(undefined); setLoading(true); setQuery(next); }}
      onChange={onChange} loading={loading} loadingMore={loadingMore} error={error || selectionError}
      hasMore={Boolean(cursor)} onRetry={() => setRetry((prev) => prev + 1)} onLoadMore={() => {
        if (paging.current || !cursor || !field.target) return;
        paging.current = true;
        setLoadingMore(true);
        setError('');
        const version = generation.current;
        void (field.target === 'contact' && customerId ? api.customerContacts(customerId, { cursor, search: query })
          : field.target === 'project' && customerId ? api.customerProjects(customerId, { cursor, search: query })
          : api.list(field.target, cursor, query)).then((result) => {
          if (version !== generation.current) return;
          setItems((prev) => [...new Map([...prev, ...result.records].map((row) => [row.id, row])).values()]);
          setKnown((prev) => [...new Map([...prev, ...result.records].map((row) => [row.id, row])).values()]);
          setCursor(result.hasMore ? result.pageToken : undefined);
        }).catch((e: unknown) => {
          if (version === generation.current) setError(errorText(e));
        }).finally(() => {
          if (version === generation.current) { paging.current = false; setLoadingMore(false); }
        });
      }} />
    {selectionError && !open && <p className="field-error" role="alert">{selectionError}</p>}
    {field.target === 'contact' && known.filter((row) => value.includes(row.id)).map((row) => {
      const issue = contactChoiceProblem(row, occurredAt ?? NaN);
      return issue ? <p key={row.id} className="field-error" role="alert">{textValue(row.record['姓名'])}：{issue}</p> : null;
    })}
    {field.key === '关联项目' && customerId === '' && <small>请先选择客户</small>}
    {field.target === 'contact' && <div className="flex flex-wrap items-center gap-2">
      {!customerId && <small>请先选择客户</small>}
      {onCreateContact && <Button type="button" size="sm" variant="ghost" disabled={disabled || !customerId}
        onClick={onCreateContact}>新建联系人</Button>}
    </div>}
  </div>;
};
