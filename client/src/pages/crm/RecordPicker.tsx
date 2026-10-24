import React, { useId } from 'react';
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandItem, CommandList } from '@/components/ui/command';

export interface RecordOption { id: string; name: string }
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
}

/** Presentation only; business records are loaded by RelationField. */
export const RecordPicker: React.FC<RecordPickerProps> = (props) => {
  const { label, multiple, disabled, open, onOpenChange, value, selected, options,
    query, onQueryChange, onChange, loading, loadingMore, error, hasMore, onLoadMore, onRetry } = props;
  const listId = useId();
  const names = value.map((id) => selected.find((item) => item.id === id)?.name || '已选记录（名称未加载）');
  return (
    <div className="record-picker">
      <Popover open={open && !disabled} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" className="record-picker-trigger"
            role="combobox" aria-label={`选择${label}`} aria-expanded={open && !disabled}
            aria-controls={open ? listId : undefined} aria-haspopup="listbox" disabled={disabled}>
            <span className={value.length ? '' : 'muted'}>{names.join('、') || `请选择${label}`}</span>
            <ChevronsUpDown size={16} aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="crm-record-popover" collisionPadding={12}>
          <Command shouldFilter={false} label={`搜索${label}`}>
            <CommandInput aria-label={`搜索${label}`} placeholder={`输入名称搜索${label}`}
              value={query} onValueChange={onQueryChange} />
            <CommandList id={listId} aria-label={`${label}候选列表`} aria-busy={loading || loadingMore}>
              {loading ? <p className="picker-message" role="status"><LoaderCircle size={16} className="spin" />正在加载…</p>
                : <>
                  {value.length > 0 && !query && selected.length > 0 && <div className="picker-heading">已选择</div>}
                  {!query && selected.map((item) => (
                    <CommandItem key={`selected-${item.id}`} value={`selected-${item.id}`}
                      aria-label={item.name} onSelect={() => {
                        if (multiple) onChange(value.filter((id) => id !== item.id));
                        else onOpenChange(false);
                      }}>
                      <Check size={16} aria-hidden="true" /><span>{item.name}</span>
                    </CommandItem>
                  ))}
                  {options.filter((item) => query || !value.includes(item.id)).map((item) => (
                    <CommandItem key={item.id} value={item.id} aria-label={item.name}
                      onSelect={() => {
                        onChange(multiple
                          ? value.includes(item.id) ? value.filter((id) => id !== item.id) : [...value, item.id]
                          : [item.id]);
                        if (!multiple) onOpenChange(false);
                      }}>
                      <Check size={16} aria-hidden="true" className={value.includes(item.id) ? '' : 'picker-unchecked'} />
                      <span>{item.name}</span>
                    </CommandItem>
                  ))}
                  {!options.length && (query || !selected.length) && !error && (
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
          <div className="picker-footer">
            <span>{multiple ? `可多选 · 已选 ${value.length} 项` : '单选 · 点击一项即可选择'}</span>
            {value.length > 0 && <Button type="button" size="sm" variant="ghost" onClick={() => onChange([])}>清空选择</Button>}
            {multiple && <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>完成</Button>}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
