// Real service + real write coordinator; only the database store is isolated in tests.
const { CrmService: ProductionCrmService } = require('../../dist/server/modules/crm/crm.service');
const { CrmFollowupWrites } = require('../../dist/server/modules/crm/crm-followup-writes');
class MemoryFollowupWriteStore {
  rows = new Map();
  async claim(recordKey, operation, ownerToken) {
    const previous = this.rows.get(recordKey);
    if (previous && previous.phase !== 'idle' && !(previous.phase === 'checking' && previous.leaseUntil < new Date())) return;
    const row = { recordKey, operation, ownerToken, phase: 'checking', leaseUntil: new Date(Date.now() + 600000), continuedId: previous?.continuedId || null };
    this.rows.set(recordKey, structuredClone(row)); return row;
  }
  async find(key) { return structuredClone(this.rows.get(key)); }
  async change(row, patch) {
    const current = this.rows.get(row.recordKey);
    if (!current || current.ownerToken !== row.ownerToken || current.phase !== row.phase) return;
    const next = { ...current, ...patch }; this.rows.set(row.recordKey, structuredClone(next)); return structuredClone(next);
  }
}
class CrmService extends ProductionCrmService {
  constructor(capability, identities, files, writes = new CrmFollowupWrites(new MemoryFollowupWriteStore())) {
    super(capability, identities, files, writes);
  }
}
module.exports = { CrmService, MemoryFollowupWriteStore, CrmFollowupWrites };
