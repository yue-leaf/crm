import React, { useEffect, useRef, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { UserSelect } from '@/components/business-ui/user-select';
import { UserDisplay } from '@/components/business-ui/user-display';
import { api } from '@/api/crm';
import type { CrmRecord } from '@shared/api.interface';
import type { Draft, FieldSpec } from '@shared/crm';
import { titles, textValue, linkIds } from '@shared/crm';

export const message = (e: unknown) =>
  e instanceof Error ? e.message : '操作未完成，请稍后重试';
const day = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const personKeys = new Set([
  '客户负责人',
  '项目负责人',
  '实际跟进人',
  '行动执行人',
  '维护人',
  '建议处理人',
  '飞书成员',
  '创建人',
  '修改人',
  '协同人员',
]);
export const Cell: React.FC<{ name: string; value: unknown }> = ({
  name,
  value,
}) => {
  if (personKeys.has(name) && Array.isArray(value))
    return (
      <div className="people">
        {value.map((id: unknown) => (
          <UserDisplay key={String(id)} value={String(id)} size="small" />
        ))}
      </div>
    );
  if (
    (name.includes('日期') || name.includes('时间')) &&
    typeof value === 'number'
  )
    return (
      <span>
        {new Intl.DateTimeFormat('zh-CN', {
          timeZone: 'Asia/Shanghai',
          dateStyle: 'medium',
          ...(name === '实际发生时间' ? { timeStyle: 'short' as const } : {}),
        }).format(value)}
      </span>
    );
  const links = linkIds(value);
  if (links.length)
    return <span className="muted">关联 {links.length} 条记录</span>;
  const s = textValue(value);
  if (!s) return <span className="muted">—</span>;
  if (
    [
      '核查标记',
      '工作状态',
      '客户关系状态',
      '联系人状态',
      '终局确认',
      '待配置角色',
      '目录状态',
    ].includes(name)
  )
    return (
      <span
        className={`tag ${s === '待核查' ? 'amber' : s === '正常' || s === '已激活' ? 'green' : ''}`}
      >
        {s}
      </span>
    );
  return <span>{s}</span>;
};
const RelationField: React.FC<{
  field: FieldSpec;
  value: string[];
  onChange: (v: string[]) => void;
}> = ({ field, value, onChange }) => {
  const [items, setItems] = useState<CrmRecord[]>([]);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<CrmRecord[]>([]);
  const generation = useRef(0);
  const paging = useRef(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const selectedIds = value.join('|');
  useEffect(() => {
    let canceled = false;
    if (!field.target || !selectedIds) {
      setSelected([]);
      return;
    }
    const target = field.target;
    void Promise.all(selectedIds.split('|').map((id) => api.get(target, id)))
      .then((rows) => {
        if (!canceled) setSelected(rows);
      })
      .catch((e) => {
        if (!canceled) setError(message(e));
      });
    return () => {
      canceled = true;
    };
  }, [field.target, selectedIds]);
  useEffect(() => {
    const version = ++generation.current;
    paging.current = false;
    setLoadingMore(false);
    setCursor(undefined);
    setItems([]);
    let canceled = false;
    const timer = setTimeout(() => {
      setError('');
      if (field.target)
        api
          .list(field.target, '', query)
          .then((r) => {
            if (!canceled && version === generation.current) {
              setItems(r.records);
              setCursor(r.hasMore ? r.pageToken : undefined);
            }
          })
          .catch((e) => {
            if (!canceled) setError(message(e));
          });
    }, 250);
    return () => {
      canceled = true;
      generation.current++;
      clearTimeout(timer);
    };
  }, [field.target, query]);
  return (
    <div className="relation-field">
      <Input
        aria-label={`搜索${field.key}`}
        placeholder={`搜索${field.key}`}
        value={query}
        onChange={(e) => {
          generation.current++;
          setCursor(undefined);
          setQuery(e.target.value);
        }}
      />
      <div className="relation-options">
        {[
          ...selected.filter((item) => value.includes(item.id)),
          ...items.filter(
            (item) =>
              !selected.some((s) => s.id === item.id && value.includes(s.id)),
          ),
        ].map((item) => (
          <Button
            type="button"
            size="sm"
            variant={value.includes(item.id) ? 'default' : 'outline'}
            key={item.id}
            onClick={() =>
              onChange(
                field.multiple
                  ? value.includes(item.id)
                    ? value.filter((id) => id !== item.id)
                    : [...value, item.id]
                  : value.includes(item.id)
                    ? []
                    : [item.id],
              )
            }
          >
            {textValue(item.record[titles[field.target!]]) || item.id}
          </Button>
        ))}
      </div>
      {cursor && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={loadingMore}
          onClick={async () => {
            if (paging.current) return;
            paging.current = true;
            setLoadingMore(true);
            const version = generation.current;
            try {
              const r = await api.list(field.target!, cursor, query);
              if (version !== generation.current) return;
              setItems((prev) => [...new Map([...prev, ...r.records].map((row) => [row.id, row])).values()]);
              setCursor(r.hasMore ? r.pageToken : undefined);
            } catch (e: unknown) {
              if (version === generation.current) setError(message(e));
            } finally {
              if (version === generation.current) {
                paging.current = false;
                setLoadingMore(false);
              }
            }
          }}
        >
          加载更多
        </Button>
      )}
      {error && <p className="field-error">{error}</p>}
      <small>已选择 {value.length} 项；保存时校验所属企业和有效状态。</small>
    </div>
  );
};
const DateField: React.FC<{
  value: string;
  onChange: (v: string) => void;
  time?: boolean;
}> = ({ value, onChange, time }) => {
  const date = value ? new Date(value.slice(0, 10) + 'T12:00:00') : undefined;
  return (
    <div className="date-field">
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline">
            <CalendarDays size={15} />
            {value.slice(0, 10) || '选择日期'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) =>
              onChange(
                d
                  ? day(d) +
                      (time ? 'T' + (value.slice(11, 16) || '09:00') : '')
                  : '',
              )
            }
          />
        </PopoverContent>
      </Popover>
      {time && (
        <Input
          aria-label="发生时间（北京时间）"
          placeholder="09:00"
          value={value.slice(11, 16)}
          onChange={(e) =>
            onChange(
              (value.slice(0, 10) || day(new Date())) + 'T' + e.target.value,
            )
          }
        />
      )}
    </div>
  );
};
export const FieldInput: React.FC<{
  field: FieldSpec;
  draft: Draft;
  onChange: (key: string, value: Draft[string]) => void;
}> = ({ field: f, draft, onChange }) => {
  const set = (v: Draft[string]) => onChange(f.key, v);
  return (
    <div className={`field ${f.type === 'long' ? 'wide' : ''}`}>
      <label>
        {f.label || f.key}
        {f.required && <em> *</em>}
      </label>
      {f.type === 'person' ? (
        <UserSelect
          accountType="apaas"
          multiple
          value={Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : []}
          onChange={(v) => set(f.multiple ? v : v.slice(-1))}
        />
      ) : f.type === 'relation' ? (
        <RelationField
          field={f}
          value={Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : []}
          onChange={set}
        />
      ) : f.type === 'select' ? (
        <Select value={String(draft[f.key] || '')} onValueChange={set}>
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(f.key === '沟通 / 推进方式'
              ? draft['记录类型'] === '内部推进'
                ? ['内部讨论', '资料处理', '其他']
                : ['电话', '线上会议', '现场', '即时消息', '邮件', '其他']
              : f.options || []
            ).map((v) => (
              <SelectItem key={v} value={v}>
                {v}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : f.type === 'long' ? (
        <Textarea
          aria-label={f.key}
          value={String(draft[f.key] || '')}
          onChange={(e) => set(e.target.value)}
          rows={3}
        />
      ) : f.type === 'date' || f.type === 'datetime' ? (
        <DateField
          value={String(draft[f.key] || '')}
          onChange={set}
          time={f.type === 'datetime'}
        />
      ) : (
        <Input
          aria-label={f.key}
          value={String(draft[f.key] ?? '')}
          type={f.type === 'number' ? 'number' : 'text'}
          step={f.type === 'number' ? '0.01' : undefined}
          onChange={(e) =>
            set(
              f.type === 'number' && e.target.value !== ''
                ? Number(e.target.value)
                : e.target.value,
            )
          }
        />
      )}
    </div>
  );
};
