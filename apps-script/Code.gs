const CONFIG = {
  spreadsheetId: '1aiWW89Tcf6cIviWaCu0_Scu4c6QGIxC3n0x7GKIbHPM',
  eventsSheet: 'Events',
  syncLogSheet: 'Sync Log',
  calendars: {
    Main: 'c_18d218cb371b633929609184a8b57308cb51dd4b664f3bd5b5a282388328583d@group.calendar.google.com',
    Additional: 'c_3d54144f81b5b17d5552e6efa3ea606aca5b435081337122bcb1000dc57d9f04@group.calendar.google.com',
    Policy: 'c_fe229d185c2798b6db19a30d8e60366ea24bd4fda9dbe1b8b9c6182ba9f84885@group.calendar.google.com'
  },
  managedBy: 'euse-v1',
  staleGraceHours: 24,
  maxDeletesPerRun: 10,
  maxDeleteRatio: 0.10,
  maxMutationRatio: 0.35,
  maxMutationAbsolute: 30,
  triggerHour: 5,
  triggerMinute: 20,
  triggerTimezone: 'Europe/Amsterdam'
};

function setup() {
  ensureSyncLogSheet_();
  removeSyncTriggers_();
  ScriptApp.newTrigger('syncAllCalendars')
    .timeBased()
    .atHour(CONFIG.triggerHour)
    .nearMinute(CONFIG.triggerMinute)
    .everyDays(1)
    .inTimezone(CONFIG.triggerTimezone)
    .create();
  Logger.log('Setup complete. Run previewSync(), then syncAllCalendarsForce() once for bootstrap.');
}

function previewSync() {
  return runSync_({dryRun: true, force: false});
}

function syncAllCalendars() {
  return runSync_({dryRun: false, force: false});
}

function syncAllCalendarsForce() {
  return runSync_({dryRun: false, force: true});
}

function runSync_(opts) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Another sync is already running.');

  let auditRow = null;
  try {
    ensureSyncLogSheet_();
    auditRow = beginAudit_(opts);

    const source = loadDesiredEvents_();
    const existing = loadManagedEvents_();
    const plan = buildPlan_(source, existing);
    validatePlanSafety_(plan, opts);

    if (opts.dryRun) {
      finishAudit_(auditRow, 'DRY_RUN', summarizePlan_(plan));
      Logger.log(JSON.stringify(plan.summary, null, 2));
      return plan.summary;
    }

    const writeResult = applyNonDeleteChanges_(plan);
    if (writeResult.errors.length) {
      finishAudit_(auditRow, 'PARTIAL_FAILURE_NO_DELETES', writeResult.errors.join(' | '));
      throw new Error('One or more insert/update operations failed; deletes were skipped. ' + writeResult.errors.join(' | '));
    }

    const deleteResult = applySafeDeletes_(plan, opts);
    const result = {
      ...plan.summary,
      inserted: writeResult.inserted,
      updated: writeResult.updated,
      deleted: deleteResult.deleted,
      deferredDeletes: deleteResult.deferred,
      sourceHash: source.sourceHash
    };

    PropertiesService.getScriptProperties().setProperties({
      LAST_SUCCESS_AT: new Date().toISOString(),
      LAST_SUCCESS_HASH: source.sourceHash
    });

    finishAudit_(auditRow, 'SUCCESS', JSON.stringify(result));
    return result;
  } catch (err) {
    if (auditRow) finishAudit_(auditRow, 'FAILED', String(err && err.message ? err.message : err));
    throw err;
  } finally {
    lock.releaseLock();
  }
}

function loadDesiredEvents_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sheet = ss.getSheetByName(CONFIG.eventsSheet);
  if (!sheet) throw new Error('Events sheet not found.');

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) throw new Error('Events sheet is empty.');
  const headers = values[0].map(String);
  const idx = indexHeaders_(headers);
  const required = ['ID','Start date','End date','Event','City','Country','Venue','Calendar','Status','Calendar title','Include in calendar','Notes / issue','Official source','Last verified','Full address'];
  required.forEach(h => { if (idx[h] === undefined) throw new Error('Missing required header: ' + h); });

  const tz = ss.getSpreadsheetTimeZone() || CONFIG.triggerTimezone;
  const allIds = new Set();
  const desired = {Main: [], Additional: [], Policy: []};
  const canonical = [];

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const rawId = row[idx['ID']];
    if (rawId === '' || rawId === null) continue;
    const masterId = String(rawId).trim();
    if (allIds.has(masterId)) throw new Error('Duplicate master ID in Sheet: ' + masterId);
    allIds.add(masterId);

    const include = String(row[idx['Include in calendar']] || '').trim().toLowerCase() === 'yes';
    if (!include) continue;

    const calendarName = String(row[idx['Calendar']] || '').trim();
    if (!CONFIG.calendars[calendarName]) throw new Error(`Unknown calendar '${calendarName}' for ID ${masterId}`);

    const status = String(row[idx['Status']] || '').trim();
    const title = String(row[idx['Calendar title']] || '').trim();
    const officialSource = String(row[idx['Official source']] || '').trim();
    const startDate = toYmd_(row[idx['Start date']], tz);
    const endInclusive = toYmd_(row[idx['End date']], tz);
    if (!title || !officialSource || !startDate || !endInclusive) throw new Error(`Calendarable row ${masterId} lacks title/source/date.`);
    if (startDate > endInclusive) throw new Error(`End date before start date for ID ${masterId}`);
    validateTitleStatus_(masterId, status, title);

    const location = buildLocation_(row, idx);
    const description = buildDescription_(row, idx, masterId);
    const eventCore = {
      summary: title,
      location: location,
      description: description,
      start: {date: startDate},
      end: {date: addDaysYmd_(endInclusive, 1)},
      transparency: 'transparent',
      visibility: 'public'
    };
    const eventHash = sha256_(JSON.stringify(eventCore));
    const event = {
      masterId,
      calendarName,
      calendarId: CONFIG.calendars[calendarName],
      resource: {
        ...eventCore,
        extendedProperties: {
          private: {
            managedBy: CONFIG.managedBy,
            masterId: masterId,
            sourceHash: eventHash
          }
        }
      }
    };
    desired[calendarName].push(event);
    canonical.push([masterId, calendarName, eventHash].join('|'));
  }

  canonical.sort();
  return {desired, sourceHash: sha256_(canonical.join('\n'))};
}

function loadManagedEvents_() {
  const result = {Main: [], Additional: [], Policy: []};
  for (const [calendarName, calendarId] of Object.entries(CONFIG.calendars)) {
    let pageToken;
    do {
      const resp = Calendar.Events.list(calendarId, {
        maxResults: 2500,
        showDeleted: false,
        privateExtendedProperty: `managedBy=${CONFIG.managedBy}`,
        pageToken: pageToken || undefined
      });
      (resp.items || []).forEach(e => result[calendarName].push(e));
      pageToken = resp.nextPageToken;
    } while (pageToken);
  }
  return result;
}

function buildPlan_(source, existing) {
  const plan = {calendars: {}, summary: {desired: 0, existingManaged: 0, inserts: 0, updates: 0, stale: 0, duplicateManaged: 0}};
  for (const calendarName of Object.keys(CONFIG.calendars)) {
    const desiredList = source.desired[calendarName];
    const existingList = existing[calendarName];
    const byMaster = new Map();
    existingList.forEach(e => {
      const p = (((e.extendedProperties || {}).private) || {});
      const masterId = p.masterId;
      if (!masterId) return;
      if (!byMaster.has(masterId)) byMaster.set(masterId, []);
      byMaster.get(masterId).push(e);
    });

    const duplicates = [...byMaster.entries()].filter(([, arr]) => arr.length > 1);
    if (duplicates.length) {
      plan.summary.duplicateManaged += duplicates.length;
    }

    const inserts = [], updates = [], unchanged = [], stale = [];
    const desiredIds = new Set();
    desiredList.forEach(d => {
      desiredIds.add(d.masterId);
      const matches = byMaster.get(d.masterId) || [];
      if (matches.length > 1) return;
      if (matches.length === 0) {
        inserts.push(d);
        return;
      }
      const e = matches[0];
      const p = (((e.extendedProperties || {}).private) || {});
      if (p.sourceHash === d.resource.extendedProperties.private.sourceHash) unchanged.push({desired: d, existing: e});
      else updates.push({desired: d, existing: e});
    });

    existingList.forEach(e => {
      const p = (((e.extendedProperties || {}).private) || {});
      if (p.masterId && !desiredIds.has(String(p.masterId))) stale.push(e);
    });

    plan.calendars[calendarName] = {inserts, updates, unchanged, stale, existingList};
    plan.summary.desired += desiredList.length;
    plan.summary.existingManaged += existingList.length;
    plan.summary.inserts += inserts.length;
    plan.summary.updates += updates.length;
    plan.summary.stale += stale.length;
  }
  return plan;
}

function validatePlanSafety_(plan, opts) {
  if (plan.summary.duplicateManaged > 0) throw new Error('Duplicate managed events detected. No writes performed.');
  if (opts.force || plan.summary.existingManaged === 0) return;

  const mutations = plan.summary.inserts + plan.summary.updates;
  const limit = Math.max(CONFIG.maxMutationAbsolute, Math.ceil(plan.summary.existingManaged * CONFIG.maxMutationRatio));
  if (mutations > limit) {
    throw new Error(`Safety halt: ${mutations} insert/update mutations exceeds limit ${limit}. Review previewSync() and use syncAllCalendarsForce() only if intentional.`);
  }
}

function applyNonDeleteChanges_(plan) {
  let inserted = 0, updated = 0;
  const errors = [];
  for (const [calendarName, p] of Object.entries(plan.calendars)) {
    const calendarId = CONFIG.calendars[calendarName];
    p.inserts.forEach(item => {
      try {
        Calendar.Events.insert(item.resource, calendarId, {sendUpdates: 'none'});
        inserted++;
      } catch (e) { errors.push(`insert ${calendarName}/${item.masterId}: ${e.message || e}`); }
    });
    p.updates.forEach(item => {
      try {
        Calendar.Events.patch(item.desired.resource, calendarId, item.existing.id, {sendUpdates: 'none'}, {'If-Match': item.existing.etag});
        updated++;
      } catch (e) { errors.push(`update ${calendarName}/${item.desired.masterId}: ${e.message || e}`); }
    });
  }
  return {inserted, updated, errors};
}

function applySafeDeletes_(plan, opts) {
  const now = Date.now();
  const props = PropertiesService.getScriptProperties();
  const eligible = [];
  let deferred = 0;

  for (const [calendarName, p] of Object.entries(plan.calendars)) {
    const desiredIds = new Set([
      ...p.inserts.map(x => x.masterId),
      ...p.updates.map(x => x.desired.masterId),
      ...p.unchanged.map(x => x.desired.masterId)
    ]);

    // Clear tombstones for events that are desired again.
    desiredIds.forEach(id => props.deleteProperty(stalePropKey_(calendarName, id)));

    p.stale.forEach(e => {
      const priv = (((e.extendedProperties || {}).private) || {});
      const masterId = String(priv.masterId || '');
      if (!masterId) return;
      const key = stalePropKey_(calendarName, masterId);
      const raw = props.getProperty(key);
      if (!raw) {
        props.setProperty(key, JSON.stringify({firstSeen: now, count: 1}));
        deferred++;
        return;
      }
      let state;
      try { state = JSON.parse(raw); } catch (_) { state = {firstSeen: now, count: 0}; }
      state.count = (state.count || 0) + 1;
      props.setProperty(key, JSON.stringify(state));
      const ageHours = (now - Number(state.firstSeen || now)) / 3600000;
      if (ageHours >= CONFIG.staleGraceHours && state.count >= 2) eligible.push({calendarName, event: e, masterId, key});
      else deferred++;
    });
  }

  const existing = plan.summary.existingManaged || 1;
  const ratio = eligible.length / existing;
  if (!opts.force && (eligible.length > CONFIG.maxDeletesPerRun || ratio > CONFIG.maxDeleteRatio)) {
    throw new Error(`Safety halt on deletes: ${eligible.length} eligible deletes (${(ratio*100).toFixed(1)}%). Use force only after review.`);
  }

  let deleted = 0;
  eligible.forEach(item => {
    const calendarId = CONFIG.calendars[item.calendarName];
    const latest = Calendar.Events.get(calendarId, item.event.id);
    const priv = (((latest.extendedProperties || {}).private) || {});
    if (priv.managedBy !== CONFIG.managedBy || String(priv.masterId) !== item.masterId) {
      throw new Error(`Refusing delete: ownership marker changed for ${item.calendarName}/${item.masterId}`);
    }
    Calendar.Events.remove(calendarId, latest.id, {sendUpdates: 'none'});
    PropertiesService.getScriptProperties().deleteProperty(item.key);
    deleted++;
  });
  return {deleted, deferred};
}

function buildLocation_(row, idx) {
  const full = String(row[idx['Full address']] || '').trim();
  if (full) return full;
  const parts = [row[idx['Venue']], row[idx['City']], row[idx['Country']]].map(v => String(v || '').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function buildDescription_(row, idx, masterId) {
  const lines = [
    `Managed by European Startup Events`,
    `Master ID: ${masterId}`,
    `Status: ${String(row[idx['Status']] || '').trim()}`,
    `Official source: ${String(row[idx['Official source']] || '').trim()}`,
    `Last verified: ${displayDate_(row[idx['Last verified']])}`
  ];
  const notes = String(row[idx['Notes / issue']] || '').trim();
  if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}

function validateTitleStatus_(id, status, title) {
  if (status === 'CONFIRMED' && /^⚠|^POSTPONED|^CANCELLED/.test(title)) throw new Error(`Confirmed ID ${id} has a warning prefix.`);
  if (status === 'TBC' && !title.startsWith('⚠ TBC —')) throw new Error(`TBC ID ${id} lacks TBC prefix.`);
  if (status === 'CONFLICT' && !title.startsWith('⚠ CONFLICT —')) throw new Error(`CONFLICT ID ${id} lacks conflict prefix.`);
}

function indexHeaders_(headers) {
  const out = {};
  headers.forEach((h, i) => { if (h) out[h] = i; });
  return out;
}

function toYmd_(value, tz) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, tz, 'yyyy-MM-dd');
  const s = String(value || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : '';
}

function addDaysYmd_(ymd, days) {
  const [y,m,d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return Utilities.formatDate(dt, 'UTC', 'yyyy-MM-dd');
}

function displayDate_(value) {
  if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value, CONFIG.triggerTimezone, 'yyyy-MM-dd');
  return String(value || '').trim();
}

function sha256_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + ((b + 256) % 256).toString(16)).slice(-2)).join('');
}

function stalePropKey_(calendarName, masterId) {
  return `STALE:${calendarName}:${masterId}`;
}

function ensureSyncLogSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sheet = ss.getSheetByName(CONFIG.syncLogSheet);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.syncLogSheet);
    sheet.getRange(1, 1, 1, 5).setValues([['Timestamp','Mode','Result','Source hash','Message']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function beginAudit_(opts) {
  const sheet = ensureSyncLogSheet_();
  sheet.appendRow([new Date(), opts.dryRun ? 'DRY_RUN' : (opts.force ? 'FORCE' : 'SAFE'), 'RUNNING', '', '']);
  return sheet.getLastRow();
}

function finishAudit_(row, result, message) {
  try {
    const sheet = ensureSyncLogSheet_();
    const lastHash = PropertiesService.getScriptProperties().getProperty('LAST_SUCCESS_HASH') || '';
    sheet.getRange(row, 3, 1, 3).setValues([[result, lastHash, String(message || '').slice(0, 50000)]]);
  } catch (e) {
    Logger.log('Audit write failed: ' + e);
  }
}

function summarizePlan_(plan) {
  return JSON.stringify(plan.summary);
}

function removeSyncTriggers_() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncAllCalendars') ScriptApp.deleteTrigger(t);
  });
}
