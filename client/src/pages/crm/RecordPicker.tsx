import React, { useId, useRef } from 'react';
import { Check, ChevronDown, LoaderCircle, Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface RecordOption { id: string; name: string; description?: string; disabledReason?: string }
interface RecordPickerProps {
  label: string;
  multiple?: boolean;
  disabled?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string[];
  selected: RecordOption[];
  options: RecordOption[];
  query: string;
  onQueryChange: (query: string) => void;
  onChange: (value: string[]) => void;
  loading: boolean;
  loadingMore: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
  onCreate?: () => void;
  createLabel?: string;
}

/** Presentation only; business records are loaded by RelationField. */
export const RecordPicker: React.FC<RecordPickerProps> = (props) => {
  const { label, multiple, disabled, open, onOpenChange, value, selected, options,
    query, onQueryChange, onChange, loading, loadingMore, error, hasMore, onLoadMore, onRetry, onCreate, createLabel } = props;
  const listId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const control = useRef<HTMLDivElement>(null);
  const creating = useRef(false);
  const selectedOptions: RecordOption[] = value.map((id) => selected.find((item) => item.id === id) || { id, name: '名称未加载' });
  const names = value.map((id) => selected.find((item) => item.id === id)?.name || '已选记录（名称未加载）');
  return (
    <div className="record-picker">
      <Popover open={open && !disabled} onOpenChange={onOpenChange}>
        <div className="record-picker-control" ref={control} data-disabled={Boolean(disabled)}>
          <PopoverTrigger asChild>
            <Button ref={trigger} type="button" variant="outline" className="record-picker-trigger"
              role="combobox" aria-label={`选择${label}${value.length ? `，已选${value.length}项：${names.join('、')}` : ''}`}
              aria-expanded={open && !disabled} aria-controls={open ? listId : undefined} aria-haspopup="listbox" disabled={disabled}
              onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); onOpenChange(true); } }}>
              <span className={multiple && value.length ? 'sr-only' : value.length ? '' : 'muted'}>
                {multiple && value.length ? `已选 ${value.length} 项` : names[0] || `请选择${label}`}
              </span><ChevronDown size={16} aria-hidden="true" />
            </Button>
          </PopoverTrigger>
          {multiple && value.length > 0 && <div className="picker-inline-selection" aria-label={`已选${label}`}>
            {value.slice(0, 2).map((id, index) => <span className="picker-chip" key={id} title={names[index]}>
              <span>{names[index]}</span><button type="button" disabled={disabled} aria-label={`移除${names[index]}`}
                onPointerDown={(event) => event.preventDefault()} onClick={(event) => {
                  event.stopPropagation(); onChange(value.filter((item) => item !== id)); trigger.current?.focus();
                }}><X size={12} aria-hidden="true" /></button>
            </span>)}
            {value.length > 2 && <button type="button" className="picker-more" disabled={disabled}
              aria-label={`查看全部 ${value.length} 项${label}`} onClick={() => onOpenChange(true)}>＋{value.length - 2}</button>}
          </div>}
        </div>
        <PopoverContent align="start" className="crm-record-popover" collisionPadding={12}
          onInteractOutside={(event) => { if (event.target instanceof Node && control.current?.contains(event.target)) event.preventDefault(); }}
          onCloseAutoFocus={(event) => { if (creating.current) { event.preventDefault(); creating.current = false; } }}>
          <Command shouldFilter={false} label={`搜索${label}`}>
            <CommandInput aria-label={`搜索${label}`} placeholder={`输入名称搜索${label}`}
              value={query} onValueChange={onQueryChange} />
            <CommandList id={listId} aria-label={`${label}候选列表`} aria-busy={loading || loadingMore}>
              {loading ? <p className="picker-message" role="status"><LoaderCircle size={16} className="spin" />正在加载…</p>
                : <>
                  {value.length > 0 && !query && selectedOptions.length > 0 && <div className="picker-heading">已选择</div>}
                  {!query && selectedOptions.map((item) => (
                    <CommandItem key={`selected-${item.id}`} value={`selected-${item.id}`}
                      aria-label={item.name} onSelect={() => {
                        if (multiple) onChange(value.filter((id) => id !== item.id));
                        else onOpenChange(false);
                      }}>
                      <Check size={16} aria-hidden="true" /><span>{item.name}{item.description && <small className="block text-muted-foreground">{item.description}</small>}</span>
                    </CommandItem>
                  ))}
                  {options.filter((item) => query || !value.includes(item.id)).map((item) => (
                    <CommandItem key={item.id} value={item.id} aria-label={item.name}
                      disabled={Boolean(item.disabledReason) && !value.includes(item.id)}
                      onSelect={() => {
                        if (multiple) onChange(value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id]);
                        else if (!value.includes(item.id)) onChange([item.id]);
                        if (!multiple) onOpenChange(false);
                      }}>
                      <Check size={16} aria-hidden="true" className={value.includes(item.id) ? '' : 'picker-unchecked'} />
                      <span>{item.name}{item.description && <small className="block text-muted-foreground">{item.description}</small>}
                        {item.disabledReason && <small className="block text-muted-foreground">{item.disabledReason}</small>}</span>
                    </CommandItem>
                  ))}
                  {!options.length && (query || !selectedOptions.length) && !error && (
                    <p className="picker-message" role="status">{query ? '没有匹配结果，请更换名称搜索' : '暂无可选记录，请先新增资料'}</p>
                  )}
                </>}
            </CommandList>
          </Command>
          {error && <div className="picker-error" role="alert">{error}
            <Button type="button" size="sm" variant="ghost" onClick={onRetry}>重试</Button>
          </div>}
          {hasMore && !loading && <Button type="button" variant="ghost" className="picker-load-more"
            disabled={loadingMore} onClick={onLoadMore}>{loadingMore ? '正在加载…' : '加载更多'}</Button>}
          {(onCreate || multiple || value.length > 0) && <div className="picker-footer">
            {onCreate && <Button type="button" size="sm" variant="ghost" className="picker-create" onClick={() => {
              creating.current = true; onOpenChange(false); onCreate();
            }}><Plus size={14} />{createLabel || '新建记录'}</Button>}
            <div className="picker-footer-actions">
            {value.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>清空</Button>}
            {multiple && <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>完成</Button>}
            </div>
          </div>}
        </PopoverContent>
      </Popover>

    </div>
  );
};
