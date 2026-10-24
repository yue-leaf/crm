import React from 'react';
import type { CrmRecord } from '@shared/api.interface';
import { detailGroups, managementLogText } from '@shared/crm-presentation';
import { textValue } from '@shared/crm';
import { Cell } from './Fields';

export const RecordDetails: React.FC<{ record: CrmRecord['record'] }> = ({ record }) => (
  <div className="detail-sections">
    {detailGroups(record).map((group) => {
      const content = <dl className="detail-grid">
        {group.fields.map(([key, value]) => (
          <div key={key} className={/备注|说明|原因|内容|摘要|记录|行动|进展/.test(key) || textValue(value).length > 70 ? 'detail-wide' : undefined}>
            <dt>{key === '结束日期' && textValue(record['终局确认']) === '未确认' ? '上次结束日期（历史）'
              : key === '归档时间' && record['已归档'] !== true ? '上次归档时间（历史）'
              : key === '下次跟进日期' && (record['已归档'] === true || ['已完成', '已取消'].includes(textValue(record['终局确认']))) ? '上次计划日期（已停用）' : key}</dt>
            <dd><Cell name={key} value={key === '管理记录' ? managementLogText(value) : value} /></dd>
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
