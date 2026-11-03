import React, { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ActionButton as Button } from './ActionButton';
import { FieldInput } from './Fields';
import { RecordPicker } from './RecordPicker';
import { forms } from '@shared/crm';
import { editFields } from '@shared/crm-edit';
import { toast } from 'sonner';
import { missingFields, requiredField } from '@shared/crm-interaction';
import type { PendingContact } from '@shared/crm-customer-create';

export const CustomerContactDrafts: React.FC<{
  lockedSelection: boolean; savedKeys: string[];
  customerName: string; contacts: PendingContact[]; selected: string[]; disabled: boolean;
  onChange: (contacts: PendingContact[], selected: string[]) => void;
}> = ({ customerName, contacts, selected, disabled, onChange, lockedSelection, savedKeys }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [child, setChild] = useState<PendingContact | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [discard, setDiscard] = useState(false);
  const [initial, setInitial] = useState('');
  const fields = (child?.original ? editFields('contact') : forms.contact).filter(f => f.key !== '所属企业' &&
    (f.key !== '停用原因' || child?.draft['联系人状态'] === '停用'))
    .map(f => requiredField(f, 'contact', child?.original ? 'edit' : 'create', child?.draft || {}));
  const options = contacts.map(c => ({ id: c.key, name: String(c.draft['姓名']), description: [c.draft['职务'], c.draft['联系人状态'] === '停用' ? '已停用' : ''].filter(Boolean).join(' · ') }));
  const start = (contact?: PendingContact) => {
    const next = contact ? structuredClone(contact) : { key: crypto.randomUUID(), draft: {} };
    setChild(next); setInitial(JSON.stringify(next.draft)); setErrors({});
  };
  const close = () => {
    if (child && JSON.stringify(child.draft) !== initial) setDiscard(true);
    else setChild(null);
  };
  return <div className="field wide" data-field="客户联系人">
    <label>客户联系人</label>
    <div className="flex items-start gap-2">
      <div className="min-w-0 flex-1"><RecordPicker label="客户联系人" multiple lockedIds={contacts.filter(c => c.original).map(c => c.key)} disabled={disabled || lockedSelection}
        open={open} onOpenChange={setOpen} value={selected} selected={options.filter(o => selected.includes(o.id))}
        options={options.filter(o => o.name.includes(query))} query={query} onQueryChange={setQuery}
        onChange={ids => {
          const existing = contacts.filter(c => c.original).map(c => c.key);
          if (existing.some(id => !ids.includes(id))) { toast.info('已有联系人请通过编辑设置为停用'); return; }
          onChange(contacts, ids);
        }} loading={false} loadingMore={false} error="" hasMore={false}
        onLoadMore={() => {}} onRetry={() => {}} /></div>
      <Button type="button" variant="outline" disabled={disabled || lockedSelection} onClick={() => start()}><Plus size={14} />新增联系人</Button>
    </div>
    {selected.map(key => { const c = contacts.find(item => item.key === key); return c &&
      <div key={key} className="flex items-center justify-between gap-2 text-sm">
        <span>{String(c.draft['姓名'])} · {String(c.draft['职务'])} · {String(c.draft['电话'] || c.draft['邮箱'])}</span>
        <Button type="button" size="sm" variant="ghost" disabled={disabled || savedKeys.includes(key)} onClick={() => start(c)}><Pencil size={14} />编辑</Button>
      </div>; })}
    <Dialog open={!!child} onOpenChange={value => { if (!value) close(); }}>
      <DialogContent className="crm-dialog" onClick={event => event.stopPropagation()}
        onKeyDown={event => { if (event.key === 'Enter' && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
        <header className="crm-dialog-header"><DialogTitle>{contacts.some(c => c.key === child?.key) ? '编辑联系人' : '新建联系人'}</DialogTitle>
          <DialogDescription className="sr-only">随客户一起保存</DialogDescription></header>
        <div className="crm-dialog-body"><div className="form-grid">
          <div className="field"><label>所属客户</label><Input disabled value={customerName || '当前新建客户'} /></div>
          {child && fields.map(f => <FieldInput key={f.key} field={f} draft={child.draft} error={errors[f.key]}
            onChange={(key, value) => { setChild({ ...child, draft: { ...child.draft, [key]: value, ...(key === '联系人状态' && value === '有效' ? { 停用原因: null } : {}) } }); setErrors({}); }} />)}
        </div></div>
        <div className="form-actions"><Button type="button" variant="outline" onClick={close}>取消</Button>
          <Button type="button" onClick={() => {
            if (!child) return;
            const invalid = missingFields(fields, child.draft); setErrors(invalid);
            if (Object.keys(invalid).length) return;
            onChange([...contacts.filter(c => c.key !== child.key), child], [...new Set([...selected, child.key])]);
            setChild(null);
          }}>{contacts.some(c => c.key === child?.key) ? '确认修改' : '添加'}</Button></div>
      </DialogContent>
    </Dialog>
    <Dialog open={discard} onOpenChange={setDiscard}><DialogContent><DialogTitle>放弃联系人修改？</DialogTitle>
      <DialogDescription>尚未添加的内容将丢失。</DialogDescription><div className="form-actions">
        <Button type="button" variant="outline" onClick={() => setDiscard(false)}>继续填写</Button>
        <Button type="button" variant="destructive" onClick={() => { setDiscard(false); setChild(null); }}>放弃修改</Button>
      </div></DialogContent></Dialog>
  </div>;
};
