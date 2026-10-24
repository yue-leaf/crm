import React from 'react';
import type { CrmRecord } from '@shared/api.interface';
import { detailGroups } from '@shared/crm-presentation';
import { textValue } from '@shared/crm';
import { Cell } from './Fields';

export const RecordDetails: React.FC<{ record: CrmRecord['record'] }> = ({ record }) => (
  <div className="detail-sections">
    {detailGroups(record).map((group) => {
      const content = <dl className="detail-grid">
        {group.fields.map(([key, value]) => (
          <div key={key} className={/备注|说明|原因|内容|摘要|记录|行动|进展/.test(key) || textValue(value).length > 70 ? 'detail-wide' : undefined}>
            <dt>{key}</dt><dd><Cell name={key} value={value} /></dd>
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
