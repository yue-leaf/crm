import React from 'react';
import type { CrmRecord, EntityKind } from '@shared/api.interface';
import { detailFieldLabel, detailGroups, displayBoolean, managementLogText, numberValue } from '@shared/crm-presentation';
import { textValue } from '@shared/crm';
import { Cell } from './Fields';
import { projectFacts } from '@shared/crm-dashboard';

const quantityUnits: Record<string, string> = {
  非终局项目数: '个', 未跟进天数: '天', 直接有效次数: '次', 整体有效次数: '次', 有效次数: '次',
};

export const RecordDetails: React.FC<{ record: CrmRecord['record']; onOpenCustomer?: (id: string) => void;
  onOpenRecord?: (id: string, kind: EntityKind) => void }> = ({ record, onOpenCustomer, onOpenRecord }) => (
  <div className="detail-sections">
    {detailGroups(record).map((group) => {
      const content = <dl className={group.title === '业务概况' ? 'detail-grid detail-overview' : 'detail-grid'}>
        {group.fields.map(([key, value]) => (
          <div key={key} className={/备注|说明|原因|内容|摘要|记录|行动|进展|附件/.test(key) || textValue(value).length > 70 ? 'detail-wide' : undefined}>
            <dt>{key === '结束日期' && textValue(record['终局确认']) === '未确认' ? '上次结束日期（历史）'
              : key === '归档时间' && record['已归档'] !== true ? '上次归档时间（历史）'
              : key === '下次跟进日期' && (record['已归档'] === true || ['已完成', '已取消'].includes(textValue(record['终局确认']))) ? '上次计划日期（已停用）' : detailFieldLabel(key)}</dt>
            <dd>{quantityUnits[key] ? numberValue(value) !== null ? <div className="detail-quantity"><strong>{numberValue(value)}</strong><span>{quantityUnits[key]}</span>
              {key === '未跟进天数' && displayBoolean('长期未跟进', record['长期未跟进']) === '长期未跟进' && <span className="tag amber">长期未跟进</span>}</div>
              : <span className="muted">暂不可用</span>
              : <Cell name={key} value={key === '工作状态' ? projectFacts({ id: '', record }, Date.now()).state || '状态异常'
                : ['管理记录', '联系人管理记录'].includes(key) ? managementLogText(value) : value}
                onOpenCustomer={onOpenCustomer} onOpenRecord={onOpenRecord} />}</dd>
          </div>
        ))}
      </dl>;
      return group.collapsed ? (
        <details className="detail-section" key={group.title}>
          <summary>{group.title}<span>展开查看</span></summary>{content}
        </details>
      ) : <section className="detail-section" key={group.title}><h3>{group.title}</h3>{content}</section>;
    })}
  </div>
);
