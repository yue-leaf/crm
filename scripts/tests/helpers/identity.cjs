// Isolated platform identity double for business tests; never imported by the app.
exports.identityFixture = (known = [123]) => ({
  async getBatchLarkUserIds(ids) { return ids.map(id => known.map(String).includes(id) ? `employee-${id}` : null); },
  async getBatchMiaodaUserIds(ids) { return ids.map(id => id.startsWith('employee-') ? id.slice(9) : null); },
});
