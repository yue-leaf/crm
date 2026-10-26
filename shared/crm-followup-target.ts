import type { Draft, FieldSpec } from './crm';
import { forms } from './crm';

// This customer is form context; project followups store only the project relation.
export const FOLLOWUP_CUSTOMER = '跟进客户';
export const followupCreateFields: FieldSpec[] = forms.followup.flatMap((field: FieldSpec) => {
  if (field.key === '跟进归属') return [];
  if (field.key === '直接客户') return [{
    key: FOLLOWUP_CUSTOMER, label: '客户', type: 'relation' as const,
    target: 'customer' as const, required: true,
  }];
  if (field.key === '关联项目') return [{ ...field, label: '项目' }];
  return [field];
});

export function changeFollowupTarget(draft: Draft, key: string, ids: string[]): Draft {
  const previous: Draft[string] | undefined = draft[key];
  if (JSON.stringify(previous || []) === JSON.stringify(ids)) return draft;
  if (key === FOLLOWUP_CUSTOMER) return {
    ...draft, [FOLLOWUP_CUSTOMER]: ids, 直接客户: ids, 关联项目: [],
    跟进归属: '客户直接跟进', 客户联系人: [],
  };
  if (key === '关联项目') return {
    ...draft, 关联项目: ids,
    直接客户: ids.length ? [] : draft[FOLLOWUP_CUSTOMER] || [],
    跟进归属: ids.length ? '项目跟进' : '客户直接跟进', 客户联系人: [],
  };
  return draft;
}

export function followupWriteDraft(draft: Draft): Draft {
  const { [FOLLOWUP_CUSTOMER]: customer, ...fields } = draft;
  const hasProject: boolean = Array.isArray(fields['关联项目']) && fields['关联项目'].length > 0;
  return {
    ...fields, 跟进归属: hasProject ? '项目跟进' : '客户直接跟进',
    直接客户: hasProject ? [] : customer || fields['直接客户'] || [],
  };
}
