const {test}=require('node:test');
const assert=require('node:assert/strict');
const {displayDate,detailGroups,statusTone,managementLogText}=require('../../dist/shared/crm-presentation.js');

test('management history shows previous business values without machine encoding',()=>{
 const {EVENT_PREFIX}=require('../../dist/shared/crm-lifecycle.js');
 const log='reopen · old-time · actor\n  New work\n'+EVENT_PREFIX+JSON.stringify({version:1,operation:'reopen',at:1,previous:{archived:true,terminal:'已完成',result:'old result',action:'old action'}});
 const output=managementLogText({text:log});
 assert.match(output,/重开项目/);assert.match(output,/New work/);assert.match(output,/结果：old result/);assert.match(output,/行动：old action/);
 assert.ok(!output.includes(EVENT_PREFIX));
});
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
test('detail sections retain selected business values and hide retired or unknown fields',()=>{
 const record={项目名称:'Example',当前下一步行动:'Next',预计金额:0,已归档:false,核查说明:'Note',管理记录:'History',修改时间:1,新增系统字段:'Hidden'};
 const groups=detailGroups(record),fields=groups.flatMap(g=>g.fields);
 assert.deepEqual(Object.fromEntries(fields),{项目名称:'Example',预计金额:0,管理记录:'History',修改时间:1});
 assert.equal(fields.length,new Set(fields.map(([key])=>key)).size);
 assert.equal(groups.find(g=>g.title==='基本资料').collapsed,false);
 assert.equal(groups.find(g=>g.title==='管理记录').collapsed,true);
 assert.equal(groups.find(g=>g.title==='操作信息').collapsed,true);
});

test('status colors distinguish progress, pause and cancellation without coloring arbitrary text',()=>{
 assert.equal(statusTone('工作状态','进行中'),'blue');
 assert.equal(statusTone('工作状态','暂停'),'amber');
 assert.equal(statusTone('终局确认','已完成'),'green');
 assert.equal(statusTone('记录状态','已作废'),'red');
 assert.equal(statusTone('联系人状态','停用'),'neutral');
 assert.equal(statusTone('客户备注','已作废'),null);
});
