import type { CrmRecord } from '@shared/api.interface';
import { textValue } from '@shared/crm';
import { ActionButton as Button } from './ActionButton';

export function FollowupChainPanel({ row, busy, onContinue, onEnd, onResume, onOpen }: {
  row: CrmRecord; busy: boolean; onContinue: () => void | Promise<void>; onEnd: () => void | Promise<void>;
  onOpen: (id: string) => void | Promise<void>;
  onResume: () => void | Promise<void>;
}) {
  const chain = row.followup;
  if (!chain) return null;
  return <section className="followup-chain-panel" aria-label="后续跟进">
    <div className="flex flex-wrap items-center gap-2"><span className={`tag ${chain.state === '待跟进' ? 'blue' : 'neutral'}`}>{chain.state}</span>
      {chain.state === '待跟进' && <><Button size="sm" disabled={busy} onClick={onContinue}>继续跟进</Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={onEnd}>结束跟进</Button></>}
      {chain.state === '已结束' && textValue(row.record['后续安排']) === '有下一步行动' &&
        <Button variant="outline" size="sm" disabled={busy} onClick={onResume}>恢复跟进</Button>}
      {chain.previousId && <Button variant="ghost" size="sm" disabled={busy} onClick={() => onOpen(chain.previousId!)}>查看上次跟进</Button>}
      {chain.nextIds.map((id, index) => <Button key={id} variant="ghost" size="sm" disabled={busy} onClick={() => onOpen(id)}>
        查看后续跟进{chain.nextIds.length > 1 ? ` ${index + 1}` : ''}</Button>)}
    </div>
    {textValue(row.record['结束跟进说明']) && <p className="muted">结束说明：{textValue(row.record['结束跟进说明'])}</p>}
  </section>;
}
