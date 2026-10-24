const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displayDate,detailGroups,statusTone}=require('../../dist/shared/crm-presentation.js');
test('time boundaries display Shanghai seconds; date-only fields keep calendar dates',()=>{
 const ms=Date.parse('2026-10-24T15:59:58Z');
 for(const key of ['归档时间','停用时间','修改时间','实际发生时间','最近有效跟进','最后目录同步'])
  assert.match(displayDate(key,ms),/2026\/10\/24.*23:59:58/);
 assert.equal(displayDate('结束日期',ms),'2026/10/24');
 assert.match(displayDate('最近整体互动',{bizType:'DateTime',value:[ms]}),/23:59:58/);
 assert.equal(displayDate('未跟进天数',3),null);
 assert.equal(displayDate('停用时间',Number.NaN),'—');
 assert.equal(displayDate('归档时间',null),'—');
});
test('detail sections preserve every returned field exactly once, including zeros and new fields',()=>{
 const record={项目名称:'Example',当前下一步行动:'Next',预计金额:0,已归档:false,核查说明:'Note',修改时间:1,新增业务字段:'Keep'};
 const groups=detailGroups(record),fields=groups.flatMap(g=>g.fields);
 assert.equal(fields.length,Object.keys(record).length);
 assert.deepEqual(Object.fromEntries(fields),record);
 assert.equal(groups.find(g=>g.title==='基本资料').collapsed,false);
 assert.equal(groups.find(g=>g.title==='核查与管理').collapsed,true);
 assert.equal(groups.find(g=>g.title==='其他与系统信息').collapsed,true);
});
test('status colors distinguish progress, pause and cancellation without coloring arbitrary text',()=>{
 assert.equal(statusTone('工作状态','进行中'),'blue');
 assert.equal(statusTone('工作状态','暂停'),'amber');
 assert.equal(statusTone('终局确认','已完成'),'green');
 assert.equal(statusTone('记录状态','已作废'),'red');
 assert.equal(statusTone('联系人状态','停用'),'neutral');
 assert.equal(statusTone('客户备注','已作废'),null);
});
