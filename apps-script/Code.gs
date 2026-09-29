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

// -----------------------------------------------------------------------------
// Submission review webhook (Tally -> Apps Script -> OpenAI -> Submissions)
// -----------------------------------------------------------------------------

const SUBMISSION_REVIEW_CONFIG = {
  submissionsSheet: 'Submissions',
  eventsSheet: 'Events',
  eventSourcesSheet: 'Event Sources',
  discoveryLeadsSheet: 'Discovery Leads',
  maxRowsPerRun: 3,
  deferredMs: 30000,
  model: 'gpt-5.6-luna'
};

/**
 * Web-app endpoint for Tally webhooks.
 *
 * Deploy this Apps Script project as a web app and configure Tally to POST to:
 *   <WEB_APP_URL>?token=<TALLY_WEBHOOK_TOKEN>
 *
 * Required Script Properties:
 *   OPENAI_API_KEY
 *   TALLY_WEBHOOK_TOKEN
 *
 * The endpoint only schedules review work and returns quickly. It never publishes.
 */
function doPost(e) {
  const props = PropertiesService.getScriptProperties();
  const expectedToken = String(props.getProperty('TALLY_WEBHOOK_TOKEN') || '');
  const suppliedToken = String(e && e.parameter ? (e.parameter.token || '') : '');

  if (!expectedToken) throw new Error('TALLY_WEBHOOK_TOKEN is not configured.');
  if (!safeEqual_(suppliedToken, expectedToken)) throw new Error('Invalid webhook token.');

  let payload = {};
  try {
    payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    throw new Error('Invalid JSON payload.');
  }

  if (String(payload.eventType || '') !== 'FORM_RESPONSE') {
    return jsonResponse_({ok: true, ignored: true});
  }

  scheduleSubmissionReview_();
  return jsonResponse_({ok: true, queued: true});
}

/**
 * Queue a near-immediate one-off review run. Multiple simultaneous submissions are
 * coalesced into one pending trigger.
 */
function scheduleSubmissionReview_() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const alreadyQueued = ScriptApp.getProjectTriggers().some(t =>
      t.getHandlerFunction() === 'processPendingSubmissions' &&
      t.getEventType() === ScriptApp.EventType.CLOCK
    );
    if (alreadyQueued) return;
    ScriptApp.newTrigger('processPendingSubmissions')
      .timeBased()
      .after(SUBMISSION_REVIEW_CONFIG.deferredMs)
      .create();
  } finally {
    lock.releaseLock();
  }
}

/**
 * Review pending submissions. Human gate remains absolute:
 * - never touches Master ID
 * - never touches Matched Master ID
 * - never touches Decision
 * - never writes Events
 * - never publishes to Calendar / GitHub / website
 */
function processPendingSubmissions() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
    const sheet = ss.getSheetByName(SUBMISSION_REVIEW_CONFIG.submissionsSheet);
    if (!sheet) throw new Error('Submissions sheet not found.');

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;

    const headers = values[0].map(String);
    const idx = indexHeaders_(headers);
    const required = [
      'url','AI suggestion','Suggested calendar','Organised by','Confidence',
      'AI review reason','Suggested event name','Suggested dates','Suggested city',
      'Suggested country','Suggested organiser','Duplicate / series match',
      'AI reviewed at','Proposed start date','Proposed end date','Proposed venue',
      'Proposed status','Proposed calendar title','Proposed notes',
      'Proposed official source','Proposed full address','Sweep cue','Decision',
      'Master ID','Matched Master ID'
    ];
    required.forEach(h => {
      if (idx[h] === undefined) throw new Error('Missing Submissions header: ' + h);
    });

    const pendingRows = [];
    for (let r = 1; r < values.length; r++) {
      const url = String(values[r][idx['url']] || '').trim();
      const reviewedAt = values[r][idx['AI reviewed at']];
      if (url && !reviewedAt) pendingRows.push(r);
    }

    if (!pendingRows.length) return;

    const context = buildSubmissionReviewContext_(ss);

    pendingRows.slice(0, SUBMISSION_REVIEW_CONFIG.maxRowsPerRun).forEach(r => {
      const row = values[r];
      const url = String(row[idx['url']] || '').trim();
      const review = callOpenAIForSubmissionReview_(url, row, idx, context);
      writeSubmissionReview_(sheet, r + 1, review);
    });

    if (pendingRows.length > SUBMISSION_REVIEW_CONFIG.maxRowsPerRun) {
      scheduleSubmissionReview_();
    }
  } finally {
    lock.releaseLock();
  }
}

function buildSubmissionReviewContext_(ss) {
  const events = ss.getSheetByName(SUBMISSION_REVIEW_CONFIG.eventsSheet);
  const eventSources = ss.getSheetByName(SUBMISSION_REVIEW_CONFIG.eventSourcesSheet);
  const discovery = ss.getSheetByName(SUBMISSION_REVIEW_CONFIG.discoveryLeadsSheet);

  const eventLines = [];
  if (events) {
    const v = events.getDataRange().getValues();
    if (v.length > 1) {
      const h = indexHeaders_(v[0].map(String));
      const wanted = ['ID','Start date','End date','Event','City','Country','Calendar','Status','Official source'];
      if (wanted.every(x => h[x] !== undefined)) {
        for (let r = 1; r < v.length; r++) {
          if (v[r][h['ID']] === '' || v[r][h['ID']] === null) continue;
          eventLines.push(wanted.map(x => {
            const val = v[r][h[x]];
            if ((x === 'Start date' || x === 'End date') && val instanceof Date && !isNaN(val)) {
              return Utilities.formatDate(val, ss.getSpreadsheetTimeZone() || 'Europe/Amsterdam', 'yyyy-MM-dd');
            }
            return String(val || '').trim();
          }).join(' | '));
        }
      }
    }
  }

  const sourceLines = compactSheetRows_(eventSources, 200);
  const discoveryLines = compactSheetRows_(discovery, 200);

  return [
    'CURRENT EVENTS INDEX (ID | start | end | event | city | country | calendar | status | official source):',
    eventLines.join('\n'),
    '',
    'EVENT SOURCES:',
    sourceLines.join('\n'),
    '',
    'DISCOVERY LEADS:',
    discoveryLines.join('\n')
  ].join('\n');
}

function compactSheetRows_(sheet, maxRows) {
  if (!sheet) return [];
  const v = sheet.getDataRange().getDisplayValues();
  if (!v.length) return [];
  const out = [v[0].join(' | ')];
  for (let r = 1; r < Math.min(v.length, maxRows + 1); r++) {
    if (v[r].some(Boolean)) out.push(v[r].join(' | '));
  }
  return out;
}

function callOpenAIForSubmissionReview_(url, row, idx, context) {
  const apiKey = String(PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY') || '');
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const submitterNotes = idx['Submitter notes'] !== undefined
    ? String(row[idx['Submitter notes']] || '').trim() : '';
  const suppliedDates = idx['Dates'] !== undefined
    ? String(row[idx['Dates']] || '').trim() : '';
  const suppliedLocation = idx['Location'] !== undefined
    ? String(row[idx['Location']] || '').trim() : '';

  const payload = {
    model: SUBMISSION_REVIEW_CONFIG.model,
    reasoning: {effort: 'low'},
    tools: [{type: 'web_search'}],
    tool_choice: 'required',
    input: [
      {
        role: 'system',
        content: [
          'You review candidate events for a curated European startup, tech, investor, ecosystem and policy calendar.',
          'Use live web search and inspect the submitted URL and primary organiser sources.',
          'Return only data matching the supplied JSON schema.',
          'Never invent dates, locations, organisers, venue addresses or sources.',
          'Use ACCEPT only for a verifiable and relevant event; REVIEW when material facts remain ambiguous; REJECT for non-events, unverifiable pages, generic sales/recruitment/promotional listings or clearly irrelevant items.',
          'Suggested calendar must be Main, Additional, Policy or Ecosystem.',
          'Organised by must be Startup, Scaleup, Investor, Corporate or Ecosystem.',
          'Compare against the supplied master index for same-occurrence duplicates and recurring-series matches.',
          'If a date is only strongly implied but not explicitly confirmed by a primary source, use REVIEW rather than inventing it.',
          'Proposed start/end dates must be YYYY-MM-DD or empty strings.',
          'For a one-day event, start_date and end_date are identical.',
          'The human will make the final decision. You are only preparing the row.'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          'Submitted URL: ' + url,
          'Submitted Dates: ' + suppliedDates,
          'Submitted Location: ' + suppliedLocation,
          'Submitter notes: ' + submitterNotes,
          '',
          context
        ].join('\n')
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'submission_review',
        strict: true,
        schema: submissionReviewSchema_()
      }
    }
  };

  const res = UrlFetchApp.fetch('https://api.openai.com/v1/responses', {
    method: 'post',
    contentType: 'application/json',
    headers: {Authorization: 'Bearer ' + apiKey},
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const raw = res.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error('OpenAI review failed (' + code + '): ' + raw.slice(0, 1000));
  }

  const body = JSON.parse(raw);
  const output = extractResponseText_(body);
  if (!output) throw new Error('OpenAI review returned no output text.');
  return JSON.parse(output);
}

function submissionReviewSchema_() {
  return {
    type: 'object',
    properties: {
      suggestion: {type: 'string', enum: ['ACCEPT','REVIEW','REJECT']},
      calendar: {type: 'string', enum: ['Main','Additional','Policy','Ecosystem']},
      organised_by: {type: 'string', enum: ['Startup','Scaleup','Investor','Corporate','Ecosystem']},
      confidence: {type: 'string', enum: ['High','Medium','Low']},
      review_reason: {type: 'string'},
      event_name: {type: 'string'},
      suggested_dates: {type: 'string'},
      city: {type: 'string'},
      country: {type: 'string'},
      organiser: {type: 'string'},
      duplicate_series_match: {type: 'string'},
      start_date: {type: 'string'},
      end_date: {type: 'string'},
      venue: {type: 'string'},
      status: {type: 'string', enum: ['CONFIRMED','TBC','CONFLICT','WATCH','POSTPONED','CANCELLED']},
      calendar_title: {type: 'string'},
      notes: {type: 'string'},
      official_source: {type: 'string'},
      full_address: {type: 'string'},
      sweep_cue: {type: 'string'}
    },
    required: [
      'suggestion','calendar','organised_by','confidence','review_reason',
      'event_name','suggested_dates','city','country','organiser',
      'duplicate_series_match','start_date','end_date','venue','status',
      'calendar_title','notes','official_source','full_address','sweep_cue'
    ],
    additionalProperties: false
  };
}

function extractResponseText_(body) {
  if (body && typeof body.output_text === 'string' && body.output_text) return body.output_text;
  const chunks = [];
  (body && body.output || []).forEach(item => {
    if (item.type !== 'message') return;
    (item.content || []).forEach(part => {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    });
  });
  return chunks.join('');
}

function writeSubmissionReview_(sheet, rowNumber, review) {
  const start = review.start_date ? parseYmd_(review.start_date) : '';
  const end = review.end_date ? parseYmd_(review.end_date) : '';

  // L:AE only. K (Master ID), AF (Matched Master ID) and AI (Decision) are untouched.
  sheet.getRange(rowNumber, 12, 1, 20).setValues([[
    review.suggestion,
    review.calendar,
    review.organised_by,
    review.confidence,
    review.review_reason,
    review.event_name,
    review.suggested_dates,
    review.city,
    review.country,
    review.organiser,
    review.duplicate_series_match,
    new Date(),
    start,
    end,
    review.venue,
    review.status,
    review.calendar_title,
    review.notes,
    review.official_source,
    review.full_address
  ]]);

  // AG Sweep cue. AF remains untouched.
  sheet.getRange(rowNumber, 33).setValue(review.sweep_cue || '');
}

function submissionReviewStatus() {
  const props = PropertiesService.getScriptProperties();
  return {
    webAppUrl: ScriptApp.getService().getUrl(),
    openAiKeyConfigured: Boolean(props.getProperty('OPENAI_API_KEY')),
    tallyWebhookTokenConfigured: Boolean(props.getProperty('TALLY_WEBHOOK_TOKEN')),
    queued: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'processPendingSubmissions')
  };
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function safeEqual_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
