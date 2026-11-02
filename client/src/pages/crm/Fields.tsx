import React, { useId, useState } from 'react';
import { zhCN } from 'date-fns/locale';
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
import { CustomerLink } from './CustomerLink';
import { ContactName } from './ContactName';
import { displayBoolean, displayDate, statusTone } from '@shared/crm-presentation';
import { followupTime } from '@shared/crm-ux';
import type { EntityKind } from '@shared/api.interface';
import { AttachmentField, AttachmentList } from './AttachmentField';

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
export const Cell: React.FC<{ name: string; value: unknown; onOpenCustomer?: (id: string) => void;
  onOpenRecord?: (id: string, kind: EntityKind) => void }> = ({
  name,
  value,
  onOpenCustomer,
  onOpenRecord,
}) => {
  if (name === '附件') return <AttachmentList value={value} />;
  const booleanLabel = displayBoolean(name, value);
  if (booleanLabel !== null) return <span className={name === '已归档' ? 'tag neutral' : undefined}>{booleanLabel}</span>;
  if (personKeys.has(name) && Array.isArray(value))
    return (
      <div className="people">
        {value.map((id: unknown) => (
          <UserDisplay key={String(id)} value={String(id)} size="small" />
        ))}
      </div>
    );
  const date = displayDate(name, value);
  if (date !== null) return <span>{date}</span>;
  const links = linkIds(value);
  const relationKind: EntityKind | undefined = ({ 客户联系人: 'contact', 已沟通联系人: 'contact', 联系人: 'contact',
    直接客户: 'customer', 关联项目: 'project', 项目: 'project', 相关业务项目: 'project' } as Record<string, EntityKind>)[name];
  if (relationKind) return links.length
    ? <div className="flex flex-col gap-1">{links.map((id: string) => <ContactName key={id} id={id} kind={relationKind}
      onOpen={onOpenRecord ? () => onOpenRecord(id, relationKind) : relationKind === 'customer' && onOpenCustomer ? () => onOpenCustomer(id) : undefined} />)}</div>
    : <span className="muted">—</span>;
  if (name === '所属企业') return links.length ? <div className="customer-links">{links.map(id => <CustomerLink key={id} id={id} onOpen={onOpenCustomer} />)}</div> : <span className="muted">未关联客户</span>;
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
  label: string;
}> = ({ value, onChange, time, label }) => {
  const [open, setOpen] = useState(false);
  const date = value ? new Date(value.slice(0, 10) + 'T12:00:00') : undefined;
  return (
    <div className="date-field">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" aria-label={`选择${label}`}>
            <CalendarDays size={15} />
            {value.slice(0, 10) || '选择日期'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0">
          <Calendar
            locale={zhCN}
            mode="single"
            required
            selected={date}
            defaultMonth={date}
            onSelect={(d) => {
              onChange(
                d
                  ? day(d) +
                      (time ? 'T' + (value.slice(11) || '09:00') : '')
                  : '',
              );
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {time && (
        <Input
          aria-label={label}
          type="time"
          step="1"
          disabled={!value.slice(0, 10)}
          title={value ? undefined : '请先选择日期'}
          value={value.slice(11)}
          onChange={(e) =>
            onChange(
              value.slice(0, 10) + (e.target.value ? 'T' + e.target.value : ''),
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
  error?: string;
  customerId?: string;
  onCreateContact?: () => void;
  onUploadBusy?: (busy: boolean) => void;
}> = ({ field: f, draft, onChange, disabled, error, customerId, onCreateContact, onUploadBusy }) => {
  const fieldId = useId();
  const set = (v: Draft[string]) => onChange(f.key, v);
  const personValue = Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : [];
  const personProps = {
    accountType: 'apaas' as const, triggerType: 'button' as const,
    loadOnOpen: f.key === '客户负责人',
    name: f.key, required: f.required, disabled,
    placeholder: `请选择${f.label || f.key}`,
    emptyText: f.key === '客户负责人' ? '暂无可选员工，可输入姓名搜索' : '请输入本企业员工姓名搜索',
    className: 'crm-person-picker',
    classNames: { trigger: 'crm-person-trigger', popover: 'crm-person-popover' },
    slotProps: { popover: { collisionPadding: 12 } },
  };
  return (
    <div className={`field ${f.type === 'long' || f.type === 'attachment' ? 'wide' : ''}`} data-field={f.key}
      data-invalid={Boolean(error)} role="group" aria-labelledby={`${fieldId}-label`}
      aria-describedby={error ? `${fieldId}-error` : undefined} onClickCapture={(event) => {
      // The platform clear button omits type; clearing a person must not submit this form.
      if (f.type === 'person' && event.target instanceof Element &&
        event.target.closest('[data-slot="combobox-clear"]')) event.preventDefault();
    }}>
      <label id={`${fieldId}-label`} htmlFor={fieldId}>
        {f.label || f.key}
        {f.required && <em> *</em>}
      </label>
      {f.type === 'attachment' ? <AttachmentField value={Array.isArray(draft[f.key]) ? draft[f.key] as string[] : []}
        onChange={set} disabled={disabled} onBusy={onUploadBusy} /> : f.type === 'person' ? (
        <>
          {f.multiple ? (
            <UserSelect {...personProps} multiple value={personValue} onChange={set} />
          ) : (
            <UserSelect {...personProps} multiple={false} value={personValue[0] || null}
              onChange={(id) => set(id ? [id] : [])} />
          )}
        </>
      ) : f.type === 'relation' ? (
        <RelationField
          field={f}
          customerId={customerId}
          occurredAt={followupTime(draft['实际发生时间'])}
          onCreateContact={onCreateContact}
          disabled={disabled}
          value={Array.isArray(draft[f.key]) ? (draft[f.key] as string[]) : []}
          onChange={set}
        />
      ) : f.type === 'select' ? (
        <Select value={String(draft[f.key] || '')} onValueChange={set}>
          <SelectTrigger id={fieldId} aria-invalid={Boolean(error)}>
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
          id={fieldId}
          aria-invalid={Boolean(error)}
          aria-label={f.label || f.key}
          value={String(draft[f.key] || '')}
          onChange={(e) => set(e.target.value)}
          rows={3}
        />
      ) : f.type === 'date' || f.type === 'datetime' ? (
        <DateField
          label={f.label || f.key}
          value={String(draft[f.key] || '')}
          onChange={set}
          time={f.type === 'datetime'}
        />
      ) : (
        <Input
          id={fieldId}
          aria-invalid={Boolean(error)}
          aria-label={f.label || f.key}
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
      {f.key === '电话' && <small className="field-hint">电话或邮箱至少填写一项。</small>}
      {f.key === '联系人状态' && draft['联系人状态'] === '停用' && <small className="field-hint">停用后保留历史跟进记录。</small>}
      {error && <p className="field-error" id={`${fieldId}-error`}>{error}</p>}
    </div>
  );
};
