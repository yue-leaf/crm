require('reflect-metadata');
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {NativeAttachmentGateway}=require('../../dist/server/modules/crm/crm-native-attachments.js');
const {CrmService}=require('../../dist/server/modules/crm/crm.service.js');
const {attachmentDraft}=require('../../dist/shared/crm-attachments.js');
const name='会议 #1 (最终).pdf';
const bytes=Buffer.from('real file bytes');
const upload=JSON.stringify({source:'upload',name,size:bytes.length,path:'12345.pdf'});
const files={getFileMetadata:async()=>({name,metadata:{contentLength:String(bytes.length)}}),download:async()=>({content:new Blob([bytes])})};
const config=()=>({personalBaseToken:'test-token'});

test('native upload sends original filename and bytes; record receives tokens, never URLs',async()=>{
 const calls=[];let saved=[];
 const gateway=new NativeAttachmentGateway(async(method,path,data,token)=>{
  calls.push({method,path});
  assert.equal(token,'test-token');
  if(path.includes('/medias/')){
   assert.equal(data.get('file_name'),name);
   assert.equal(data.get('file').name,name);
   assert.deepEqual(Buffer.from(await data.get('file').arrayBuffer()),bytes);
   assert.equal(data.get('parent_type'),'bitable_file');
   assert.equal(data.get('parent_node'),'base1');
   return{code:0,data:{file_token:'new-token'}};
  }
  if(method==='PUT'){assert.deepEqual(data,{fields:{附件:[{file_token:'new-token'}]}});saved=[{file_token:'new-token',name,size:bytes.length}];}
  return{code:0,data:{record:{fields:{附件:saved}}}};
 },config);
 const plan=await gateway.prepare('base1','tbl1',[upload],[],files);
 await gateway.apply(plan,'rec1');
 assert.deepEqual(plan.expected,[{name,size:bytes.length}]);
 assert.equal(calls.filter(c=>c.method==='PUT').length,1);
 assert.equal(calls.filter(c=>c.path.includes('/auth/')).length,0);
});

test('retain/remove attachments uses existing native tokens without URL re-import',async()=>{
 const old={name:'原文件.pdf',size:2,type:'application/pdf',tmpUrl:'https://signed.example/temporary'};
 let submitted;
 const gateway=new NativeAttachmentGateway(async(method,path,data)=>{
  if(method==='PUT')submitted=data;
  return {code:0,data:{record:{fields:{附件:[{file_token:'old-token',name:old.name,size:old.size}]}}}};
 },config);
 const plan=await gateway.prepare('base1','tbl1',attachmentDraft([old]),[old],files,'rec1');
 await gateway.apply(plan,'rec1');
 assert.deepEqual(submitted.fields.附件,[{file_token:'old-token'}]);
 const clear=await gateway.prepare('base1','tbl1',[],[old],files,'rec1');
 assert.deepEqual(clear.tokens,[]);
});

test('missing credentials, permission failure and changed files stop before business mutation',async()=>{
 const missing=new NativeAttachmentGateway(async()=>{throw new Error('must not call');},()=>({}));
 await assert.rejects(missing.prepare('base1','tbl1',[upload],[],files),/尚未配置/);
 const denied=new NativeAttachmentGateway(async()=>({code:99991672}),config);
 await assert.rejects(denied.prepare('base1','tbl1',[upload],[],files),/权限/);
 let writes=0;
 const service=new CrmService({getCapability:()=>({formValue:{appToken:'base1',tableID:'tbl1',fields:[]}}),load:()=>({call:async()=>{writes++;}})}, {}, files);
 service.nativeAttachments=missing;service.people=async()=>{};service.relationChecks=async()=>{};
 await assert.rejects(service.create('followup',{跟进主题:'会议',跟进归属:'客户直接跟进',直接客户:['recCustomer'],记录类型:'内部推进',实际发生时间:'2026-10-20T10:00:00',实际跟进人:['123'],'内容 / 推进结论':'结论',后续安排:'无后续动作',无后续动作结论:'完成',附件:[upload]}),/尚未配置/);
 assert.equal(writes,0);
});

test('native write failure identifies existing record and is never auto-retried',async()=>{
 let writes=0;
 const gateway=new NativeAttachmentGateway(async(method,path)=>{
  writes++;throw new Error('upstream details must not leak');
 },config);
 await assert.rejects(gateway.apply({base:'base1',table:'tbl1',tokens:['t'],expected:[]},'rec1'),/记录 rec1 已保存/);
 assert.equal(writes,1);
});

test('default transport sends the configured personal token only to the Base API host',async()=>{
 const axios=require('axios');const previous=axios.defaults.adapter;
 const key='FEISHU_BASE_PERSONAL_TOKEN',original=process.env[key];
 process.env[key]='  test-personal-token  ';
 const urls=[];
 axios.defaults.adapter=async request=>{
  urls.push(request.url);
  assert.equal(new URL(request.url).origin,'https://base-api.feishu.cn');
  assert.equal(request.headers.get('Authorization'),'Bearer test-personal-token');
  assert.equal(request.maxRedirects,0);
  return{status:200,statusText:'OK',headers:{},config:request,data:{code:0}};
 };
 try{
  await new NativeAttachmentGateway().prepare('base1','tbl1',[],[],files);
  assert.deepEqual(urls,['https://base-api.feishu.cn/open-apis/bitable/v1/apps/base1/tables/tbl1']);
 }finally{axios.defaults.adapter=previous;if(original===undefined)delete process.env[key];else process.env[key]=original;}
});

test('native readback checks original names as well as token identity',async()=>{
 const gateway=new NativeAttachmentGateway(async method=>method==='PUT'?{code:0}:
  {code:0,data:{record:{fields:{附件:[{file_token:'t',name:'12345.pdf',size:bytes.length}]}}}},config);
 await assert.rejects(gateway.apply({base:'base1',table:'tbl1',tokens:['t'],expected:[{name,size:bytes.length}]},'rec1'),/附件写入尚未确认/);
});

test('explicit removal writes an empty native attachment array',async()=>{
 let submitted;
 const gateway=new NativeAttachmentGateway(async(method,path,data)=>{
  if(method==='PUT')submitted=data;
  return{code:0,data:{record:{fields:{附件:[]}}}};
 },config);
 await gateway.apply({base:'base1',table:'tbl1',tokens:[],expected:[]},'rec1');
 assert.deepEqual(submitted,{fields:{附件:[]}});
});

test('create writes business fields first then native attachments and verifies the same record',async()=>{
 let written,applied;
 const service=new CrmService({getCapability:()=>({formValue:{appToken:'base1',tableID:'tbl1',fields:[]}}),
  load:()=>({call:async(action,input)=>{written=input.records[0].record;assert.equal(Object.hasOwn(written,'附件'),false);return{records:[{id:'rec1'}]};}})}, {}, files);
 service.people=async()=>{};service.relationChecks=async()=>{};
 service.nativeAttachments={prepare:async()=>({base:'base1',table:'tbl1',tokens:['t'],expected:[{name,size:bytes.length}]}),
  apply:async(plan,id)=>{assert.ok(written);applied=id;}};
 service.get=async()=>{assert.equal(applied,'rec1');return{id:'rec1',record:{...written,直接客户:{link_record_ids:written.直接客户},附件:[{name,size:bytes.length,type:'application/pdf',tmpUrl:'https://example.com/file'}]}};};
 const result=await service.create('followup',{跟进主题:'会议',跟进归属:'客户直接跟进',直接客户:['recCustomer'],记录类型:'内部推进',实际发生时间:'2026-10-20T10:00:00',实际跟进人:['123'],'内容 / 推进结论':'结论',后续安排:'无后续动作',无后续动作结论:'完成',附件:[upload]});
 assert.equal(result.id,'rec1');
});
