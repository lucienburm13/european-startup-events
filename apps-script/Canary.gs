function canarySync() {
  const canaryMasterId = '1';
  const source = loadDesiredEvents_();
  let desired = null;
  Object.values(source.desired).forEach(list => {
    list.forEach(item => { if (item.masterId === canaryMasterId) desired = item; });
  });
  if (!desired) throw new Error('Canary master ID 1 not found in desired source.');

  const resp = Calendar.Events.list(desired.calendarId, {
    maxResults: 2500,
    showDeleted: false,
    privateExtendedProperty: `managedBy=${CONFIG.managedBy}`
  });
  const matches = (resp.items || []).filter(e => {
    const p = (((e.extendedProperties || {}).private) || {});
    return String(p.masterId || '') === canaryMasterId;
  });
  if (matches.length > 1) throw new Error('Duplicate managed canary events found; refusing write.');

  if (matches.length === 0) {
    const created = Calendar.Events.insert(desired.resource, desired.calendarId, {sendUpdates: 'none'});
    Logger.log(`Canary inserted: ${created.id}`);
    return {action: 'inserted', eventId: created.id, calendar: desired.calendarName};
  }

  const existing = matches[0];
  const currentHash = ((((existing.extendedProperties || {}).private) || {}).sourceHash || '');
  const desiredHash = desired.resource.extendedProperties.private.sourceHash;
  if (currentHash === desiredHash) {
    Logger.log(`Canary already correct: ${existing.id}`);
    return {action: 'unchanged', eventId: existing.id, calendar: desired.calendarName};
  }

  const updated = Calendar.Events.patch(
    desired.resource,
    desired.calendarId,
    existing.id,
    {sendUpdates: 'none'},
    {'If-Match': existing.etag}
  );
  Logger.log(`Canary updated: ${updated.id}`);
  return {action: 'updated', eventId: updated.id, calendar: desired.calendarName};
}

function removeCanary() {
  const masterId = '1';
  const calendarId = CONFIG.calendars.Main;
  const resp = Calendar.Events.list(calendarId, {
    maxResults: 2500,
    showDeleted: false,
    privateExtendedProperty: `managedBy=${CONFIG.managedBy}`
  });
  const matches = (resp.items || []).filter(e => {
    const p = (((e.extendedProperties || {}).private) || {});
    return String(p.masterId || '') === masterId;
  });
  matches.forEach(e => {
    const p = (((e.extendedProperties || {}).private) || {});
    if (p.managedBy !== CONFIG.managedBy) throw new Error('Refusing to delete non-managed canary.');
    Calendar.Events.remove(calendarId, e.id, {sendUpdates: 'none'});
  });
  return {removed: matches.length};
}
