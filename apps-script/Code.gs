const CONFIG = {
  spreadsheetId: '1aiWW89Tcf6cIviWaCu0_Scu4c6QGIxC3n0x7GKIbHPM',
  eventsSheet: 'Events',
  syncLogSheet: 'Sync Log',
  calendars: {
    Main: 'c_18d218cb371b633929609184a8b57308cb51dd4b664f3bd5b5a282388328583d@group.calendar.google.com',
    Additional: 'c_3d54144f81b5b17d5552e6efa3ea606aca5b435081337122bcb1000dc57d9f04@group.calendar.google.com',
    Policy: 'c_fe229d185c2798b6db19a30d8e60366ea24bd4fda9dbe1b8b9c6182ba9f84885@group.calendar.google.com'
  },
  managedBy: 'euse-v2',
  scanPastDays: 365,
  scanFutureDays: 730,
  staleGraceHours: 24,
  maxDeletesPerRun: 10,
  maxDeleteRatio: 0.10,
  maxMutationRatio: 0.35,
  maxMutationAbsolute: 30,
  triggerHour: 5
};

function setup() {
  ensureSyncLogSheet_();
  removeSyncTriggers_();
  ScriptApp.newTrigger('syncAllCalendars').timeBased().atHour(CONFIG.triggerHour).everyDays(1).create();
  Logger.log('Setup complete. Daily sync installed.');
}

function previewSync() { return runSync_({dryRun: true, force: false}); }
function syncAllCalendars() { return runSync_({dryRun: false, force: false}); }
function syncAllCalendarsForce() { return runSync_({dryRun: false, force: true}); }

function canarySync() {
  const source = loadDesiredEvents_();
  const desired = findDesiredByMasterId_(source, '1');
  if (!desired) throw new Error('Canary master ID 1 not found.');
  const existing = loadManagedEvents_();
  const matches = existing[desired.calendarName].filter(e => e.masterId === '1');
  if (matches.length > 1) throw new Error('Duplicate managed canary events found; refusing write.');
  const cal = getCalendar_(desired.calendarName);
  if (matches.length === 0) {
    const event = createEvent_(cal, desired);
    return {action: 'inserted', eventId: event.getId(), calendar: desired.calendarName};
  }
  const match = matches[0];
  if (match.sourceHash === desired.sourceHash) {
    return {action: 'unchanged', eventId: match.event.getId(), calendar: desired.calendarName};
  }
  updateEvent_(match.event, desired);
  return {action: 'updated', eventId: match.event.getId(), calendar: desired.calendarName};
}

function removeCanary() {
  const existing = loadManagedEvents_();
  const matches = existing.Main.filter(e => e.masterId === '1');
  if (matches.length > 1) throw new Error('Duplicate managed canaries found; refusing delete.');
  matches.forEach(x => {
    if (x.event.getTag('managedBy') !== CONFIG.managedBy) throw new Error('Refusing to delete non-managed canary.');
    x.event.deleteEvent();
  });
  return {removed: matches.length};
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
      finishAudit_(auditRow, 'DRY_RUN', JSON.stringify(plan.summary));
      Logger.log(JSON.stringify(plan.summary, null, 2));
      return plan.summary;
    }
    const writes = applyNonDeleteChanges_(plan);
    if (writes.errors.length) {
      finishAudit_(auditRow, 'PARTIAL_FAILURE_NO_DELETES', writes.errors.join(' | '));
      throw new Error('Insert/update failed; deletes skipped. ' + writes.errors.join(' | '));
    }
    const deletes = applySafeDeletes_(plan, opts);
    const result = {...plan.summary, inserted:writes.inserted, updated:writes.updated, deleted:deletes.deleted, deferredDeletes:deletes.deferred, sourceHash:source.sourceHash};
    PropertiesService.getScriptProperties().setProperties({LAST_SUCCESS_AT:new Date().toISOString(), LAST_SUCCESS_HASH:source.sourceHash});
    finishAudit_(auditRow, 'SUCCESS', JSON.stringify(result));
    return result;
  } catch (err) {
    if (auditRow) finishAudit_(auditRow, 'FAILED', String(err && err.message ? err.message : err));
    throw err;
  } finally { lock.releaseLock(); }
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
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone();
  const seenIds = new Set();
  const desired = {Main: [], Additional: [], Policy: []};
  const canonical = [];
  for (let r=1; r<values.length; r++) {
    const row = values[r];
    const rawId = row[idx['ID']];
    if (rawId === '' || rawId === null) continue;
    const masterId = String(rawId).trim();
    if (seenIds.has(masterId)) throw new Error('Duplicate master ID in Sheet: ' + masterId);
    seenIds.add(masterId);
    if (String(row[idx['Include in calendar']] || '').trim().toLowerCase() !== 'yes') continue;
    const calendarName = String(row[idx['Calendar']] || '').trim();
    if (!CONFIG.calendars[calendarName]) throw new Error(`Unknown calendar '${calendarName}' for ID ${masterId}`);
    const status = String(row[idx['Status']] || '').trim();
    const title = String(row[idx['Calendar title']] || '').trim();
    const officialSource = String(row[idx['Official source']] || '').trim();
    const startYmd = toYmd_(row[idx['Start date']], tz);
    const endInclusiveYmd = toYmd_(row[idx['End date']], tz);
    if (!title || !officialSource || !startYmd || !endInclusiveYmd) throw new Error(`Calendarable row ${masterId} lacks title/source/date.`);
    if (startYmd > endInclusiveYmd) throw new Error(`End date before start date for ID ${masterId}`);
    validateTitleStatus_(masterId, status, title);
    const location = buildLocation_(row, idx);
    const description = buildDescription_(row, idx, masterId);
    const endExclusiveYmd = addDaysYmd_(endInclusiveYmd, 1);
    const canonicalEvent = {title,startYmd,endExclusiveYmd,location,description,transparency:'transparent',visibility:'public'};
    const sourceHash = sha256_(JSON.stringify(canonicalEvent));
    const item = {masterId,calendarName,title,startYmd,endExclusiveYmd,location,description,sourceHash};
    desired[calendarName].push(item);
    canonical.push([masterId,calendarName,sourceHash].join('|'));
  }
  canonical.sort();
  return {desired, sourceHash:sha256_(canonical.join('\n'))};
}

function loadManagedEvents_() {
  const result = {Main: [], Additional: [], Policy: []};
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()-CONFIG.scanPastDays);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()+CONFIG.scanFutureDays);
  for (const calendarName of Object.keys(CONFIG.calendars)) {
    const events = getCalendar_(calendarName).getEvents(start, end);
    events.forEach(event => {
      if (event.getTag('managedBy') !== CONFIG.managedBy) return;
      const masterId = String(event.getTag('masterId') || '');
      if (!masterId) return;
      result[calendarName].push({event, masterId, sourceHash:String(event.getTag('sourceHash') || '')});
    });
  }
  return result;
}

function buildPlan_(source, existing) {
  const plan = {calendars:{}, summary:{desired:0,existingManaged:0,inserts:0,updates:0,unchanged:0,stale:0,duplicateManaged:0}};
  for (const calendarName of Object.keys(CONFIG.calendars)) {
    const desiredList = source.desired[calendarName], existingList = existing[calendarName];
    const byMaster = new Map();
    existingList.forEach(x => { if (!byMaster.has(x.masterId)) byMaster.set(x.masterId, []); byMaster.get(x.masterId).push(x); });
    [...byMaster.values()].forEach(arr => { if (arr.length > 1) plan.summary.duplicateManaged++; });
    const inserts=[], updates=[], unchanged=[], stale=[], desiredIds=new Set();
    desiredList.forEach(d => {
      desiredIds.add(d.masterId);
      const matches = byMaster.get(d.masterId) || [];
      if (matches.length > 1) return;
      if (matches.length === 0) inserts.push(d);
      else if (matches[0].sourceHash === d.sourceHash) unchanged.push({desired:d, existing:matches[0]});
      else updates.push({desired:d, existing:matches[0]});
    });
    existingList.forEach(x => { if (!desiredIds.has(x.masterId)) stale.push(x); });
    plan.calendars[calendarName] = {inserts,updates,unchanged,stale};
    plan.summary.desired += desiredList.length;
    plan.summary.existingManaged += existingList.length;
    plan.summary.inserts += inserts.length;
    plan.summary.updates += updates.length;
    plan.summary.unchanged += unchanged.length;
    plan.summary.stale += stale.length;
  }
  return plan;
}

function validatePlanSafety_(plan, opts) {
  if (plan.summary.duplicateManaged > 0) throw new Error('Duplicate managed events detected. No writes performed.');
  if (opts.dryRun) return;
  if (plan.summary.existingManaged === 0 && !opts.force) throw new Error('Bootstrap safety halt. Run previewSync(), inspect counts, then run syncAllCalendarsForce() once.');
  if (opts.force || plan.summary.existingManaged === 0) return;
  const mutations = plan.summary.inserts + plan.summary.updates;
  const limit = Math.max(CONFIG.maxMutationAbsolute, Math.ceil(plan.summary.existingManaged * CONFIG.maxMutationRatio));
  if (mutations > limit) throw new Error(`Safety halt: ${mutations} insert/update mutations exceeds limit ${limit}. Review previewSync() before any force run.`);
}

function applyNonDeleteChanges_(plan) {
  let inserted=0, updated=0; const errors=[];
  for (const [calendarName,p] of Object.entries(plan.calendars)) {
    const cal = getCalendar_(calendarName);
    p.inserts.forEach(item => { try { createEvent_(cal,item); inserted++; } catch(e) { errors.push(`insert ${calendarName}/${item.masterId}: ${e.message || e}`); } });
    p.updates.forEach(item => { try { updateEvent_(item.existing.event,item.desired); updated++; } catch(e) { errors.push(`update ${calendarName}/${item.desired.masterId}: ${e.message || e}`); } });
  }
  return {inserted,updated,errors};
}

function applySafeDeletes_(plan, opts) {
  const now=Date.now(), props=PropertiesService.getScriptProperties(), eligible=[]; let deferred=0;
  for (const [calendarName,p] of Object.entries(plan.calendars)) {
    const desiredIds = new Set([...p.inserts.map(x=>x.masterId), ...p.updates.map(x=>x.desired.masterId), ...p.unchanged.map(x=>x.desired.masterId)]);
    desiredIds.forEach(id => props.deleteProperty(stalePropKey_(calendarName,id)));
    p.stale.forEach(x => {
      const key=stalePropKey_(calendarName,x.masterId), raw=props.getProperty(key);
      if (!raw) { props.setProperty(key, JSON.stringify({firstSeen:now,count:1})); deferred++; return; }
      let state; try { state=JSON.parse(raw); } catch(_) { state={firstSeen:now,count:0}; }
      state.count=(state.count||0)+1; props.setProperty(key,JSON.stringify(state));
      const ageHours=(now-Number(state.firstSeen||now))/3600000;
      if (ageHours>=CONFIG.staleGraceHours && state.count>=2) eligible.push({calendarName,managed:x,key}); else deferred++;
    });
  }
  const existing=plan.summary.existingManaged||1, ratio=eligible.length/existing;
  if (!opts.force && (eligible.length>CONFIG.maxDeletesPerRun || ratio>CONFIG.maxDeleteRatio)) throw new Error(`Safety halt on deletes: ${eligible.length} eligible deletes (${(ratio*100).toFixed(1)}%).`);
  let deleted=0;
  eligible.forEach(item => {
    const event=item.managed.event;
    if (event.getTag('managedBy')!==CONFIG.managedBy || String(event.getTag('masterId')||'')!==item.managed.masterId) throw new Error(`Refusing delete: ownership marker changed for ${item.calendarName}/${item.managed.masterId}`);
    event.deleteEvent(); props.deleteProperty(item.key); deleted++;
  });
  return {deleted,deferred};
}

function createEvent_(calendar,item) {
  const event = calendar.createAllDayEvent(item.title, parseYmd_(item.startYmd), parseYmd_(item.endExclusiveYmd), {description:item.description, location:item.location, sendInvites:false});
  event.setTransparency(CalendarApp.EventTransparency.TRANSPARENT).setVisibility(CalendarApp.Visibility.PUBLIC).setTag('managedBy',CONFIG.managedBy).setTag('masterId',item.masterId).setTag('sourceHash',item.sourceHash);
  return event;
}

function updateEvent_(event,item) {
  if (event.getTag('managedBy')!==CONFIG.managedBy || String(event.getTag('masterId')||'')!==item.masterId) throw new Error(`Ownership mismatch for master ID ${item.masterId}`);
  event.setTitle(item.title).setAllDayDates(parseYmd_(item.startYmd),parseYmd_(item.endExclusiveYmd)).setDescription(item.description).setLocation(item.location).setTransparency(CalendarApp.EventTransparency.TRANSPARENT).setVisibility(CalendarApp.Visibility.PUBLIC).setTag('sourceHash',item.sourceHash);
  return event;
}

function getCalendar_(calendarName) {
  const cal = CalendarApp.getCalendarById(CONFIG.calendars[calendarName]);
  if (!cal) throw new Error(`Calendar not accessible: ${calendarName}`);
  return cal;
}

function findDesiredByMasterId_(source,masterId) {
  for (const list of Object.values(source.desired)) for (const item of list) if (item.masterId===masterId) return item;
  return null;
}

function buildLocation_(row,idx) {
  const full=String(row[idx['Full address']]||'').trim(); if (full) return full;
  const parts=[row[idx['Venue']],row[idx['City']],row[idx['Country']]].map(v=>String(v||'').trim()).filter(Boolean);
  return [...new Set(parts)].join(', ');
}

function buildDescription_(row,idx,masterId) {
  const lines=['European Startup Events',`Master ID: ${masterId}`,`Status: ${String(row[idx['Status']]||'').trim()}`,`Official source: ${String(row[idx['Official source']]||'').trim()}`,`Last verified: ${displayDate_(row[idx['Last verified']])}`];
  const notes=String(row[idx['Notes / issue']]||'').trim(); if (notes) lines.push(`Notes: ${notes}`);
  return lines.join('\n');
}

function validateTitleStatus_(id,status,title) {
  if (status==='CONFIRMED' && /^(⚠|POSTPONED|CANCELLED)/.test(title)) throw new Error(`Confirmed ID ${id} has a warning prefix.`);
  if (status==='TBC' && !title.startsWith('⚠ TBC —')) throw new Error(`TBC ID ${id} lacks TBC prefix.`);
  if (status==='CONFLICT' && !title.startsWith('⚠ CONFLICT —')) throw new Error(`CONFLICT ID ${id} lacks conflict prefix.`);
}

function indexHeaders_(headers) { const out={}; headers.forEach((h,i)=>{if(h) out[h]=i;}); return out; }
function toYmd_(value,tz) { if (value instanceof Date && !isNaN(value)) return Utilities.formatDate(value,tz,'yyyy-MM-dd'); const s=String(value||'').trim(); if(!s)return''; if(/^\d{4}-\d{2}-\d{2}$/.test(s))return s; const d=new Date(s); return isNaN(d)?'':Utilities.formatDate(d,tz,'yyyy-MM-dd'); }
function parseYmd_(ymd) { const m=String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})$/); if(!m) throw new Error('Invalid YYYY-MM-DD date: '+ymd); return new Date(Number(m[1]),Number(m[2])-1,Number(m[3])); }
function addDaysYmd_(ymd,days) { const d=parseYmd_(ymd); d.setDate(d.getDate()+days); return Utilities.formatDate(d,Session.getScriptTimeZone(),'yyyy-MM-dd'); }
function displayDate_(value) { if(value instanceof Date&&!isNaN(value)) return Utilities.formatDate(value,Session.getScriptTimeZone(),'yyyy-MM-dd'); return String(value||'').trim(); }
function sha256_(text) { const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8); return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function stalePropKey_(calendarName,masterId) { return `STALE__${calendarName}__${masterId}`; }

function ensureSyncLogSheet_() {
  const ss=SpreadsheetApp.openById(CONFIG.spreadsheetId); let sheet=ss.getSheetByName(CONFIG.syncLogSheet);
  if(!sheet){ sheet=ss.insertSheet(CONFIG.syncLogSheet); sheet.getRange(1,1,1,5).setValues([['Started at','Mode','Status','Details','Finished at']]); sheet.setFrozenRows(1); }
  return sheet;
}
function beginAudit_(opts) { const sheet=ensureSyncLogSheet_(), row=sheet.getLastRow()+1; sheet.getRange(row,1,1,5).setValues([[new Date(),opts.dryRun?'DRY_RUN':(opts.force?'FORCE':'NORMAL'),'RUNNING','','']]); return row; }
function finishAudit_(row,status,details) { ensureSyncLogSheet_().getRange(row,3,1,3).setValues([[status,String(details||'').slice(0,45000),new Date()]]); }
function removeSyncTriggers_() { ScriptApp.getProjectTriggers().forEach(t=>{if(t.getHandlerFunction()==='syncAllCalendars') ScriptApp.deleteTrigger(t);}); }