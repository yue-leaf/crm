import assert from 'node:assert/strict';

const empty = value => value == null || value === '' || (Array.isArray(value) && value.length === 0);
export function writableCell(field, value) {
  if (!field || !['text','phone','url','number','select','datetime','checkbox','user','group_chat','link'].includes(field.type)) throw new Error('Unsupported writable field: ' + field?.name);
  if (empty(value)) return null;
  if (field.type === 'select') return field.multiple ? (Array.isArray(value) ? value : [value]) : (Array.isArray(value) ? value[0] : value);
  if (['user','group_chat','link'].includes(field.type)) return value.map(v => ({ id: v.id }));
  if (field.type === 'number') return Number(value);
  if (field.type === 'checkbox') return value === true || value === 'true';
  if (field.type === 'datetime') {
    const iso = /^\d{4}-\d\d-\d\dT/.test(value);
    if (!iso) return value;
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) throw new Error('Invalid datetime: ' + field.name);
    return new Date(timestamp + 8 * 3600000).toISOString().slice(0,19).replace('T',' ');
  }
  return value;
}
export function normalizedCell(field, value) {
  const v = writableCell(field, value);
  if (v == null) return field.type === 'checkbox' ? false : null;
  if (['user','group_chat','link'].includes(field.type)) return v.map(x => x.id).sort();
  if (field.type === 'select' && field.multiple) return [...v].sort();
  if (field.type === 'datetime') return Date.parse((v.length === 10 ? v + 'T00:00:00' : v.replace(' ','T')) + '+08:00');
  return v;
}
export function assertNoIgnoredFields(response) {
  function visit(v) {
    if (!v || typeof v !== 'object') return;
    for (const [key, value] of Object.entries(v)) {
      if (key === 'ignored_fields' && value && Object.keys(value).length) throw new Error('Record update ignored fields: ' + JSON.stringify(value));
      visit(value);
    }
  }
  visit(response);
}
export async function writeAndVerify({ patch, get, field, delay, timeoutMs = 10000 }, table, key, values) {
  const payload = Object.fromEntries(Object.entries(values).map(([name,value]) => [name,writableCell(field(table,name),value)]));
  assertNoIgnoredFields(patch(table,key,payload));
  const started = Date.now();
  for (;;) {
    try {
      const actual = get(table,key);
      for (const [name,value] of Object.entries(payload)) assert.deepEqual(normalizedCell(field(table,name),actual[name]),normalizedCell(field(table,name),value),'Raw field readback mismatch: '+table+'/'+key+'/'+name);
      return;
    } catch (error) {
      if (Date.now()-started >= timeoutMs) throw error;
      await delay(1000);
    }
  }
}
export function scenarioRunner(deps) {
  const {get,field,save,delay,checks,isFixture} = deps;
  return async function scenario(name, changes, verify) {
    const restore=[];
    let result;
    try {
      for (const [table,key,values] of changes) {
        const original=get(table,key);
        if(!isFixture(table,key,original))throw new Error('Refuse non-fixture record');
        const before=Object.fromEntries(Object.keys(values).map(k=>[k,writableCell(field(table,k),original[k])]));
        restore.push([table,key,before]);
        save('verification/pending-restoration.json',{scenario:name,restore});
        await writeAndVerify(deps,table,key,values);
      }
      const started=Date.now();let firstReadError=null;
      for (;;) {
        try {verify();result={name,passed:true,rawWritesVerified:true,firstReadError,convergenceMs:Date.now()-started};break;}
        catch(error){firstReadError??=error.message;if(Date.now()-started>(deps.convergenceTimeoutMs??30000))throw error;await delay(2000);}
      }
    } catch(error){result={name,passed:false,error:error.message};}
    finally {
      // Keep each recovery entry until that record's original raw values have been read back.
      while(restore.length){
        const [table,key,values]=restore[restore.length-1];
        try { await writeAndVerify(deps,table,key,values); }
        catch(error){
          checks.push({...result,passed:false,restorationVerified:false,restorationError:error.message});
          save('verification/pending-restoration.json',{scenario:name,restore,error:error.message});
          throw new Error('Restoration failed; ledger retained, stop further tests: '+error.message);
        }
        restore.pop();
        save('verification/pending-restoration.json',{scenario:name,restore,...(!restore.length?{restoredAt:new Date().toISOString()}: {})});
      }
      checks.push({...result,restorationVerified:true});
    }
  };
}
