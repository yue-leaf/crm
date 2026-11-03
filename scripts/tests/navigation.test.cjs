const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readRelatedPages, RecordPageChanged } = require('../../dist/shared/crm-navigation.js');

const page = (n, last = false) => ({ records: [{ id: `r${n}`, record: { name: `fresh-${n}` } }],
  sources: { [`r${n}`]: { id: 'customer', kind: 'customer', name: '客户' } },
  hasMore: !last, ...(!last ? { pageToken: String(n + 1) } : {}) });
const state = () => ({ page: null, depth: 0, targetDepth: 3, canceled: () => false,
  onPage(next, depth) { this.page = next; this.depth = depth; } });

test('return restores all loaded pages with fresh values, source labels and no duplicate rows', async () => {
  const progress = state();
  const requests = [];
  progress.load = async cursor => { const n = Number(cursor || 1); requests.push(n); return page(n, n === 3); };
  await readRelatedPages(progress);
  assert.deepEqual(requests, [1, 2, 3]);
  assert.deepEqual(progress.page.records.map(r => r.id), ['r1', 'r2', 'r3']);
  assert.equal(Object.keys(progress.page.sources).length, 3);
  assert.equal(progress.depth, 3);
});

test('real HTTP connection failure keeps first page and retries from failed cursor', async t => {
  const requested = [];
  let fail = true;
  const server = http.createServer((req, res) => {
    const n = Number(new URL(req.url, 'http://localhost').searchParams.get('cursor') || 1);
    requested.push(n);
    if (n === 2 && fail) { req.socket.destroy(); return; }
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(page(n, n === 3)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const progress = state();
  progress.load = async cursor => (await fetch(`http://127.0.0.1:${server.address().port}/?cursor=${cursor || ''}`)).json();
  await assert.rejects(readRelatedPages(progress), /fetch failed/);
  assert.equal(progress.depth, 1);
  assert.deepEqual(progress.page.records.map(r => r.id), ['r1']);
  fail = false;
  await readRelatedPages(progress);
  assert.deepEqual(requested, [1, 2, 2, 3]);
  assert.equal(progress.depth, 3);
  assert.deepEqual(progress.page.records.map(r => r.id), ['r1', 'r2', 'r3']);
});

test('deleted records can shorten the range without endless reads; malformed cursors stop', async () => {
  const progress = state();
  progress.load = async () => page(1, true);
  await readRelatedPages(progress);
  assert.equal(progress.depth, 1);
  await assert.rejects(readRelatedPages({ ...state(), load: async () => ({ records: [], hasMore: true }) }), /分页信息异常/);
  await assert.rejects(readRelatedPages({ ...state(), load: async () => page(1) }), /分页信息异常/);
});

test('late response after navigation cannot update the new location', async () => {
  let canceled = false;
  const progress = state();
  progress.canceled = () => canceled;
  progress.load = async () => { canceled = true; return page(1); };
  await readRelatedPages(progress);
  assert.equal(progress.page, null);
  assert.equal(progress.depth, 0);
});

test('a stale related cursor reloads the full requested range without mixing old and new rows',async()=>{
 const progress={...state(),page:page(1),depth:1};const requests=[];
 progress.load=async cursor=>{
  requests.push(cursor);
  if(cursor==='2')throw new RecordPageChanged('关联记录已变化');
  const n=Number(cursor||11);return page(n,n===13);
 };
 await readRelatedPages(progress);
 assert.deepEqual(requests,['2',undefined,'12','13']);
 assert.deepEqual(progress.page.records.map(row=>row.id),['r11','r12','r13']);
 assert.deepEqual(Object.keys(progress.page.sources),['r11','r12','r13']);
 assert.equal(progress.depth,3);
});

test('continuously changing lists stop after one restart; retry can recover and late conflicts do not restart',async()=>{
 const progress={...state(),page:page(1),depth:1};let count=0;
 progress.load=async cursor=>{count++;if(cursor)throw new RecordPageChanged('busy');return page(3);};
 await assert.rejects(readRelatedPages(progress),RecordPageChanged);assert.equal(count,3);
 progress.load=async cursor=>page(Number(cursor),true);
 await readRelatedPages(progress);assert.deepEqual(progress.page.records.map(row=>row.id),['r3','r4']);
 let canceled=false;count=0;
 await readRelatedPages({...state(),page:page(1),depth:1,canceled:()=>canceled,
  load:async()=>{count++;canceled=true;throw new RecordPageChanged('late');}});
 assert.equal(count,1);
});
