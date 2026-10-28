require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attachmentDraft, attachmentRef, attachmentSignature, safeAttachmentUrl, MAX_ATTACHMENT_BYTES } = require('../../dist/shared/crm-attachments.js');
const { parseDraft } = require('../../dist/server/modules/crm/crm-validation.js');
const { resolveAttachments, attachmentWriteMatches, verifyAttachmentContent } = require('../../dist/server/modules/crm/crm-attachments.js');
const { originalAttachmentNames, attachmentMetadata } = require('../../dist/shared/crm-attachment-metadata.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const {hashBytes}=require('../../dist/server/modules/crm/crm-file-content.js');
const contentHash=hashBytes(Buffer.alloc(456));
const old = { name: '会议纪要.pdf', size: 123, type: 'application/pdf', tmpUrl: 'https://files.example/old?signed=1' };
const fresh = (patch = {}) => JSON.stringify({ source: 'upload', name: '报价.xlsx', size: 456, path: 'uploads/unique/quote.xlsx', ...patch });
const row = () => ({ id: 'recFollowup', record: { 跟进主题: '会议', 跟进归属: '客户直接跟进', 直接客户: { link_record_ids: ['recCustomer'] },
  记录类型: '内部推进', 实际发生时间: Date.parse('2026-10-20T02:00:00Z'), 实际跟进人: [123], '内容 / 推进结论': '已沟通',
  后续安排: '无后续动作', 无后续动作结论: '已完成', 记录状态: '正常', 修改时间: 123, 附件: [old] } });
const files = {
  download: async()=>({content:new Blob([Buffer.alloc(456)])}),
  getFileMetadata: async path => { assert.equal(path, 'uploads/unique/quote.xlsx'); return { name: '报价.xlsx', metadata: { contentLength: '456' } }; },
  createSignedUrl: async (path, expiry) => { assert.equal(expiry, 3600); return 'https://storage.example/quote?signature=1'; },
};

test('content verification rejects same-size different bytes and matches reordered files one-to-one', async () => {
  const a=hashBytes(Buffer.from('abc')), b=hashBytes(Buffer.from('xyz'));
  const expected=[{name:'原名甲.pdf',size:3,sha256:a},{name:'原名乙.pdf',size:3,sha256:b}];
  const actual=[{...old,name:'999',size:3,tmpUrl:'https://files.example/b'}, {...old,name:'888',size:3,tmpUrl:'https://files.example/a'}];
  const readHash=async url=>url.endsWith('/b')?b:a;
  const result=await verifyAttachmentContent(actual,expected,readHash);
  assert.deepEqual(result.map(f=>f.name),['原名乙.pdf','原名甲.pdf']);
  await assert.rejects(verifyAttachmentContent(actual,expected,async()=>a),/内容不一致/);
  await assert.rejects(verifyAttachmentContent(actual.slice(1),expected,readHash),/数量不一致/);
  const record={附件:actual,附件元数据:JSON.stringify({version:1,files:result})};
  originalAttachmentNames(record,'recFiles');
  originalAttachmentNames(record,'recFiles');
  assert.deepEqual(record.附件.map(f=>f.name),['原名乙.pdf','原名甲.pdf']);
  assert.deepEqual(attachmentDraft(record.附件).map(s=>JSON.parse(s).name),['原名乙.pdf','原名甲.pdf']);
});

test('attachment download requires login and returns original Unicode filename', async () => {
  const {CrmController}=require('../../dist/server/modules/crm/crm.controller.js');
  let calls=0;
  const controller=new CrmController({downloadAttachment:async()=>{calls++;return {content:Buffer.from('abc'),name:'会议记录 (最终).pdf'};}});
  await assert.rejects(controller.downloadAttachment({},'recFiles','0'),/登录/);
  assert.equal(calls,0);
  const response=await controller.downloadAttachment({userContext:{userId:'123'}},'recFiles','0');
  assert.equal(response.getHeaders().length,3);
  assert.equal(decodeURIComponent(response.getHeaders().disposition.split("UTF-8''")[1]),'会议记录 (最终).pdf');
});

test('eventually consistent attachment and metadata reads retry without duplicate business writes', async()=>{
  let reads=0, updates=0;
  const native={...old,name:'prior-upload.pdf'};
  let record={附件:[native]};
  const cap={load:()=>({call:async(action,input)=>{
    if(action==='getRecord'){
      reads++;
      const value=structuredClone(record);
      if(reads===1)value.附件=[];
      if(reads===3)delete value.附件元数据;
      return {id:'recExisting',record:value};
    }
    assert.equal(action,'batchUpdateRecords'); updates++;
    assert.deepEqual(Object.keys(input.records[0].record),['附件元数据']);
    Object.assign(record,input.records[0].record);
    return {records:[{id:'recExisting'}]};
  }})};
  const service=new CrmService(cap,{},files);
  service.attachmentHash=async()=>contentHash;
  await service.verifySaved('followup','recExisting',{附件:['https://storage.example/new']},[{name:old.name,size:123,sha256:contentHash}]);
  assert.equal(updates,1);assert.equal(reads,4);
  assert.equal(attachmentMetadata(record.附件元数据)[0].name,old.name);
});

test('attachment payload rejects URLs, malformed paths, oversized and forged entries', () => {
  for (const path of ['https://internal/private', '//host/a', '../a', 'x/../a', 'a\\b', 'x?q=1', ''])
    assert.throws(() => attachmentRef(fresh({ path })));
  assert.throws(() => attachmentRef(fresh({ size: MAX_ATTACHMENT_BYTES + 1 })));
  assert.throws(() => attachmentRef(fresh({ source: 'existing', index: -1 })));
  assert.throws(() => parseDraft({ 附件: ['https://host/file'] }, [{ key: '附件', type: 'attachment' }], {}), /附件信息无效/);
  assert.equal(safeAttachmentUrl('javascript:alert(1)'), undefined);
  assert.equal(safeAttachmentUrl('https://user:secret@host/file'), undefined);
});
test('retained files use fresh server links; new files use verified default-bucket metadata', async () => {
  const result = await resolveAttachments([...attachmentDraft([old]), fresh()], [{ ...old, tmpUrl: 'https://files.example/fresh' }], files);
  assert.deepEqual(result.urls, ['https://files.example/fresh', 'https://storage.example/quote?signature=1']);
  assert.deepEqual(result.expected, [{ name: old.name, size: 123 }, { name: '报价.xlsx', size: 456, storageName: 'quote.xlsx' }]);
  await assert.rejects(resolveAttachments(attachmentDraft([old]), [], files), /文件已变化/);
  await assert.rejects(resolveAttachments([fresh(), fresh()], [], files), /重复/);
  await assert.rejects(resolveAttachments([fresh({ size: 455 })], [], files), /文件校验失败/);
  await assert.rejects(resolveAttachments([fresh()], [], { ...files, getFileMetadata: async () => null }), /文件校验失败/);
});
test('ordinary edits preserve attachments, explicit removal clears them', () => {
  const edited = prepareEdit('followup', row(), { changes: { 跟进主题: '会议更新' } }, {}, '123');
  assert.equal(Object.hasOwn(edited.writes, '附件'), false);
  const cleared = prepareEdit('followup', row(), { changes: { 附件: [] } }, {}, '123');
  assert.deepEqual(cleared.writes.附件, []);
  assert.match(cleared.writes.管理记录, /附件/);
});
test('signed URL rotation does not cause a conflict, metadata changes and missing writes are detected', () => {
  assert.equal(attachmentSignature([old]), attachmentSignature([{ ...old, tmpUrl: 'https://files.example/new' }]));
  assert.notEqual(attachmentSignature([old]), attachmentSignature([{ ...old, size: 124 }]));
  assert.equal(attachmentWriteMatches([old], [{ name: old.name, size: 123 }]), true);
  assert.equal(attachmentWriteMatches([], [{ name: old.name, size: 123 }]), false);
  assert.equal(attachmentWriteMatches([old, old], [{ name: old.name, size: 123 }]), false);
  assert.equal(attachmentWriteMatches(null, []), true);
});
test('service update writes URL array and checks native attachment readback', async () => {
  let saved = row(); let writes;
  const cap = {
    getCapability: () => ({ formValue: { fields: [] } }),
    load: () => ({ call: async (action, input) => {
      if (action === 'getRecord') return structuredClone(saved);
      assert.equal(action, 'batchUpdateRecords'); writes ||= input.records[0].record;
      saved = { ...saved, record: { ...saved.record, ...input.records[0].record, 附件: [old, { name: '报价.xlsx', size: 456, type: 'application/octet-stream', tmpUrl: 'https://files.example/new' }] } };
      return { records: [{ id: saved.id }] };
    } }),
  };
  const service = new CrmService(cap, {}, files);
  service.attachmentHash=async()=>contentHash;
  service.people = async () => {}; service.relationChecks = async () => {};
  await service.update('followup', saved.id, 'edit', { expectedModifiedAt: 123, changes: { 附件: [...attachmentDraft([old]), fresh()] } }, '123');
  assert.deepEqual(writes.附件, [old.tmpUrl, 'https://storage.example/quote?signature=1']);
  assert.match(writes.管理记录, /附件/);
});
test('storage errors abort before any record mutation', async () => {
  let writes = 0;
  const cap = { getCapability: () => ({ formValue: { fields: [] } }), load: () => ({ call: async action => {
    if (action === 'getRecord') return row(); writes++; throw new Error('unexpected write');
  } }) };
  const service = new CrmService(cap, {}, { ...files, createSignedUrl: async () => { throw new Error('provider internal detail'); } });
  service.attachmentHash=async()=>contentHash;
  service.people = async () => {}; service.relationChecks = async () => {};
  await assert.rejects(service.update('followup', 'recFollowup', 'edit', { expectedModifiedAt: 123, changes: { 附件: [fresh()] } }, '123'), /记录尚未保存/);
  assert.equal(writes, 0);
});
test('native storage filename is accepted only with matching size and a trusted exact alias',()=>{
 const expected=[{name:'Chip-Test-CD-FFF2-8001.der',size:235,storageName:'1880306867927224.der'}];
 const native={...old,name:'1880306867927224.der',size:235};
 assert.equal(attachmentWriteMatches([native],expected),true);
 assert.equal(attachmentWriteMatches([{...native,name:expected[0].name}],expected),true);
 assert.equal(attachmentWriteMatches([{...native,name:'unrelated.der'}],expected),false);
 assert.equal(attachmentWriteMatches([{...native,size:234}],expected),false);
 assert.equal(attachmentWriteMatches([native,native],expected),false);
 assert.equal(attachmentWriteMatches([],expected),false);
});
test('ambiguous original/storage names are matched one-to-one rather than by order or size alone',()=>{
 const expected=[{name:'one',storageName:'two',size:235},{name:'one',storageName:'three',size:235}];
 assert.equal(attachmentWriteMatches([{...old,name:'one',size:235},{...old,name:'two',size:235}],expected),true);
 assert.equal(attachmentWriteMatches([{...old,name:'two',size:235},{...old,name:'two',size:235}],expected),false);
});
test('deduplicated upload uses prior native name but preserves original name without duplicate creation',async()=>{
 let stored,writes=0;
 const cap={getCapability:()=>({formValue:{fields:[]}}),load:()=>({call:async(action,input)=>{
  if(action==='getRecord')return{id:'recCreated',record:stored};
  if(action==='batchUpdateRecords'){Object.assign(stored,input.records[0].record);return {records:[{id:'recCreated'}]};}
  assert.equal(action,'batchAddRecords');writes++;
  stored={...input.records[0].record,直接客户:{link_record_ids:['recCustomer']},附件:[{...old,name:'1880306867927224.der',size:235}]};
  return{records:[{id:'recCreated'}]};
 }})};
 const service=new CrmService(cap,{}, {download:async()=>({content:new Blob([Buffer.alloc(235)])}),getFileMetadata:async()=>({name:'Chip-Test-CD-FFF2-8001.der',metadata:{contentLength:'235'}}),createSignedUrl:async()=> 'https://storage.example/1880306867927224.der?signature=1'});
 service.attachmentHash=async()=>hashBytes(Buffer.alloc(235));
 service.people=async()=>{};service.relationChecks=async()=>{};
 const draft={跟进主题:'项目沟通',跟进归属:'客户直接跟进',直接客户:['recCustomer'],记录类型:'内部推进',实际发生时间:'2026-10-28T10:00:00',实际跟进人:['123'],'内容 / 推进结论':'实验确认',后续安排:'无后续动作',无后续动作结论:'完成',附件:[fresh({name:'Chip-Test-CD-FFF2-8001.der',path:'1880307947535363.der',size:235})]};
 assert.equal((await service.create('followup',draft)).id,'recCreated');assert.equal(writes,1);
 const loaded=await service.get('followup','recCreated');
 assert.equal(loaded.record.附件[0].name,'Chip-Test-CD-FFF2-8001.der');
 assert.equal(loaded.record.附件[0].nativeName,'1880306867927224.der');
 assert.equal(loaded.record.附件[0].downloadPath,'/api/crm/followups/recCreated/attachments/0');
 assert.equal(attachmentMetadata(stored.附件元数据)[0].sha256,hashBytes(Buffer.alloc(235)));
});
test('create persists native attachments and fails visibly on incomplete plugin readback', async () => {
  for (const drop of [false, true]) {
    let stored;
    const cap = { getCapability: () => ({ formValue: { fields: [] } }), load: () => ({ call: async (action, input) => {
      if (action === 'getRecord') return { id: 'recCreated', record: stored };
      if(action==='batchUpdateRecords'){Object.assign(stored,input.records[0].record);return {records:[{id:'recCreated'}]};}
      assert.equal(action, 'batchAddRecords');
      assert.deepEqual(input.records[0].record.附件, ['https://storage.example/quote?signature=1']);
      stored = { ...input.records[0].record, 直接客户: { link_record_ids: ['recCustomer'] },
        附件: drop ? [] : [{ name: '报价.xlsx', size: 456, type: 'application/octet-stream', tmpUrl: 'https://files.example/new' }] };
      return { records: [{ id: 'recCreated' }] };
    } }) };
    const service = new CrmService(cap, {}, files);
    service.attachmentHash=async()=>contentHash;
  service.people = async () => {}; service.relationChecks = async () => {};
    const draft = { 跟进主题: '新会议', 跟进归属: '客户直接跟进', 直接客户: ['recCustomer'], 记录类型: '内部推进',
      实际发生时间: '2026-10-20T10:00:00', 实际跟进人: ['123'], '内容 / 推进结论': '结论', 后续安排: '无后续动作', 无后续动作结论: '完成', 附件: [fresh()] };
    if (drop) await assert.rejects(service.create('followup', draft), /附件内容回读尚未确认/);
    else assert.equal((await service.create('followup', draft)).id, 'recCreated');
  }
});
