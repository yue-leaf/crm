require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { attachmentDraft, attachmentRef, attachmentSignature, safeAttachmentUrl, MAX_ATTACHMENT_BYTES } = require('../../dist/shared/crm-attachments.js');
const { parseDraft } = require('../../dist/server/modules/crm/crm-validation.js');
const { resolveAttachments, attachmentWriteMatches } = require('../../dist/server/modules/crm/crm-attachments.js');
const { prepareEdit } = require('../../dist/server/modules/crm/crm-edit.js');
const { CrmService } = require('../../dist/server/modules/crm/crm.service.js');
const old = { name: '会议纪要.pdf', size: 123, type: 'application/pdf', tmpUrl: 'https://files.example/old?signed=1' };
const fresh = (patch = {}) => JSON.stringify({ source: 'upload', name: '报价.xlsx', size: 456, path: 'uploads/unique/报价.xlsx', ...patch });
const row = () => ({ id: 'recFollowup', record: { 跟进主题: '会议', 跟进归属: '客户直接跟进', 直接客户: { link_record_ids: ['recCustomer'] },
  记录类型: '内部推进', 实际发生时间: Date.parse('2026-10-20T02:00:00Z'), 实际跟进人: [123], '内容 / 推进结论': '已沟通',
  后续安排: '无后续动作', 无后续动作结论: '已完成', 记录状态: '正常', 修改时间: 123, 附件: [old] } });
const files = {
  getFileMetadata: async path => { assert.equal(path, 'uploads/unique/报价.xlsx'); return { name: '报价.xlsx', metadata: { contentLength: '456' } }; },
  createSignedUrl: async (path, expiry) => { assert.equal(expiry, 3600); return 'https://storage.example/quote?signature=1'; },
};

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
  assert.deepEqual(result.expected, [{ name: old.name, size: 123 }, { name: '报价.xlsx', size: 456 }]);
  await assert.rejects(resolveAttachments(attachmentDraft([old]), [], files), /文件已变化/);
  await assert.rejects(resolveAttachments([fresh(), fresh()], [], files), /重复/);
  await assert.rejects(resolveAttachments([fresh({ size: 455 })], [], files), /文件校验失败/);
  await assert.rejects(resolveAttachments([fresh()], [], { ...files, getFileMetadata: async () => null }), /文件校验失败/);
});
test('ordinary edits preserve attachments, explicit removal clears them', () => {
  const edited = prepareEdit('followup', row(), { changes: { '内容 / 推进结论': '会议更新' } }, {}, '123');
  assert.equal(Object.hasOwn(edited.writes, '跟进主题'), false);
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
test('upload path preserves original names and isolates identical basenames', () => {
 const {attachmentUploadPath}=require('../../dist/shared/crm-attachments.js');
 for(const name of ['Chip-Test-CD-FFF2-8001.der','会议记录 #1 (最终).pdf']){
  const path=attachmentUploadPath(name,'abc-123');
  assert.equal(path.split('/').at(-1),name);
  assert.notEqual(path,attachmentUploadPath(name,'abc-456'));
  attachmentRef(fresh({name,path}));
 }
 assert.throws(()=>attachmentUploadPath('../secret','abc'));
});
test('numeric object paths fail before business write; native names must match', async()=>{
 const legacy={getFileMetadata:async()=>({name:'original.der',metadata:{contentLength:'235'}}),createSignedUrl:async()=>{throw new Error('must not sign');}};
 await assert.rejects(resolveAttachments([fresh({name:'original.der',size:235,path:'123.der'})],[],legacy),/旧版页面上传/);
 assert.equal(attachmentWriteMatches([{...old,name:'123.der',size:235}],[{name:'original.der',size:235}]),false);
});
