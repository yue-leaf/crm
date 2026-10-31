require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { employeeOptions, defaultEmployeeSelection } = require('../../dist/shared/crm-people.js');
const { CrmController } = require('../../dist/server/modules/crm/crm.controller.js');

test('dual identities only expose employee account, preserving distinct same-name employees', () => {
  const external = { userID: '101', name: 'Same name', userType: '_externalUser' };
  const employee = { userID: '202', name: 'Same name', userType: '_employee' };
  const namesake = { userID: '303', name: 'Same name', userType: '_employee' };
  assert.deepEqual(employeeOptions([external, employee, namesake, employee]), [employee, namesake]);
});

test('unregistered external and unknown account types are not employee choices', () => {
  assert.deepEqual(employeeOptions([
    { userID: '101' }, { userID: '102', userType: '_anonymousUser' },
    { userType: '_employee', larkUserID: '123456' },
    { userID: '_unknown', userType: '_employee' },
  ]), []);
});

test('external login and incomplete session never prefill an employee field', () => {
  const controller = new CrmController({});
  for (const userType of ['_externalUser', '_anonymousUser', undefined]) {
    const session = controller.current({ userContext: { userId: '101', userType, tenantId: 1 } });
    assert.deepEqual(defaultEmployeeSelection(session), []);
  }
  assert.deepEqual(defaultEmployeeSelection(null), []);
  assert.deepEqual(defaultEmployeeSelection({ userId: '101', name: 'Legacy session' }), []);
  const session = controller.current({ userContext: { userId: '202', userType: '_employee', tenantId: 1 } });
  assert.deepEqual(defaultEmployeeSelection(session), ['202']);
});
