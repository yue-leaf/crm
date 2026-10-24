import React from 'react';
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
import type { Draft, FieldSpec } from '@shared/crm';
import { textValue, linkIds } from '@shared/crm';
import { RelationField } from './RelationField';
import { displayDate, statusTone } from '@shared/crm-presentation';

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
  const date = displayDate(name, value);
  if (date !== null) return <span title="北京时间">{date}</span>;
  const links = linkIds(value);
  if (links.length)
    return <span className="muted">关联 {links.length} 条记录</span>;
  const s = textValue(value);
  if (!s) return <span className="muted">—</span>;
  const tone = statusTone(name, s);
  if (tone) return <span className={`tag ${tone}`}>{s}</span>;
  return <span>{s}</span>;
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
  disabled?: boolean;
}> = ({ field: f, draft, onChange, disabled }) => {
  const set = (v: Draft[string]) => onChange(f.key, v);
  const personValue = Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : [];
  const personProps = {
    accountType: 'apaas' as const, triggerType: 'search' as const,
    name: f.key, required: f.required, disabled,
    placeholder: `请选择${f.label || f.key}`,
    emptyText: '请输入员工姓名搜索；新增人员须已同步且已激活',
    className: 'crm-person-picker',
    classNames: { trigger: 'crm-person-trigger', popover: 'crm-person-popover' },
    slotProps: { popover: { collisionPadding: 12 } },
  };
  return (
    <div className={`field ${f.type === 'long' ? 'wide' : ''}`} onClickCapture={(event) => {
      // The platform clear button omits type; clearing a person must not submit this form.
      if (f.type === 'person' && event.target instanceof Element &&
        event.target.closest('[data-slot="combobox-clear"]')) event.preventDefault();
    }}>
      <label>
        {f.label || f.key}
        {f.required && <em> *</em>}
      </label>
      {f.type === 'person' ? (
        <>
          {f.multiple ? (
            <UserSelect {...personProps} multiple value={personValue} onChange={set} />
          ) : (
            <UserSelect {...personProps} multiple={false} value={personValue[0] || null}
              onChange={(id) => set(id ? [id] : [])} />
          )}
          <small className="field-hint">点击选择框，输入员工姓名搜索{f.multiple ? '，可多选' : '，选择一人'}。</small>
        </>
      ) : f.type === 'relation' ? (
        <RelationField
          field={f}
          disabled={disabled}
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
