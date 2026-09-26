/**
 * Submission approval -> Events publisher.
 *
 * Install once by running installSubmissionApprovalTrigger().
 * After that, changing Submissions > Decision to APPROVE publishes a fully
 * reviewed row into Events and writes the new Master ID back to Submissions.
 *
 * Safety rules:
 * - Only reacts to a human edit in the Decision column.
 * - Never publishes rows with missing required proposed publication fields.
 * - Blocks known source aliases and likely same-occurrence duplicates.
 * - A human DUPLICATE decision records an alternative URL and a sweep lead.
 * - Never changes the human Decision value.
 */
const SUBMISSION_APPROVAL = {
  spreadsheetId: '1aiWW89Tcf6cIviWaCu0_Scu4c6QGIxC3n0x7GKIbHPM',
  submissionsSheet: 'Submissions',
  eventsSheet: 'Events',
  handler: 'handleSubmissionDecisionEdit'
};

function installSubmissionApprovalTrigger() {
  const ss = SpreadsheetApp.openById(SUBMISSION_APPROVAL.spreadsheetId);
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === SUBMISSION_APPROVAL.handler)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(SUBMISSION_APPROVAL.handler)
    .forSpreadsheet(ss)
    .onEdit()
    .create();
}

function handleSubmissionDecisionEdit(e) {
  if (!e || !e.range) return;
  const sh = e.range.getSheet();
  if (sh.getName() !== SUBMISSION_APPROVAL.submissionsSheet) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  const headers = headerMap_(sh);
  const decisionCol = headers['Decision'];
  if (!decisionCol || e.range.getColumn() !== decisionCol) return;

  const decision = String(e.value || '').trim().toUpperCase();
  if (decision === 'APPROVE') publishApprovedSubmission_(sh, e.range.getRow(), headers);
  if (decision === 'DUPLICATE') recordDuplicateSubmission_(sh, e.range.getRow(), headers);
}

function publishApprovedSubmission_(submissionsSheet, rowNumber, subHeaders) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const width = submissionsSheet.getLastColumn();
    const values = submissionsSheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    const row = rowObject_(subHeaders, values);

    if (String(row['Master ID'] || '').trim()) return;
    if (String(row['Matched Master ID'] || '').trim()) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Publication blocked: a Matched Master ID is set; review this as a duplicate.');
      return;
    }

    const required = {
      'Suggested event name': row['Suggested event name'],
      'Proposed start date': row['Proposed start date'],
      'Suggested city': row['Suggested city'],
      'Suggested country': row['Suggested country'],
      'Suggested calendar': row['Suggested calendar'],
      'Proposed status': row['Proposed status'],
      'Proposed official source': row['Proposed official source']
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !hasValue_(value))
      .map(([key]) => key);

    if (missing.length) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Publication blocked: missing ' + missing.join(', ') + '.');
      return;
    }

    const calendarName = String(row['Suggested calendar']).trim();
    if (!CONFIG.calendars[calendarName]) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Publication blocked: calendar ' + calendarName + ' is not configured.');
      return;
    }
    const organisedBy = String(row['Organised by'] || '').trim();
    if (calendarName === 'Ecosystem' && !['Startup','Scaleup','Investor','Corporate','Ecosystem'].includes(organisedBy)) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Publication blocked: Organised by must identify the organiser type.');
      return;
    }

    const ss = SpreadsheetApp.openById(SUBMISSION_APPROVAL.spreadsheetId);
    const eventsSheet = ss.getSheetByName(SUBMISSION_APPROVAL.eventsSheet);
    const eventHeaders = headerMap_(eventsSheet);
    if (calendarName === 'Ecosystem' && !eventHeaders['Organised by']) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Publication blocked: Events sheet needs an Organised by column.');
      return;
    }
    const eventData = eventsSheet.getDataRange().getValues();
    const source = normalizeUrl_(row['Proposed official source']);
    const submittedSource = normalizeUrl_(row['url']);
    const name = normalizeEventName_(row['Suggested event name']);
    const start = dateKey_(row['Proposed start date']);
    const candidateCity = String(row['Suggested city'] || '').trim().toLowerCase();

    const sourceSheet = ss.getSheetByName('Event Sources');
    if (sourceSheet) {
      const aliases = sourceSheet.getDataRange().getValues();
      for (let i = 1; i < aliases.length; i++) {
        if ((source && source === String(aliases[i][0] || '')) ||
            (submittedSource && submittedSource === String(aliases[i][0] || ''))) {
          appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
            'Publication blocked: URL is an alternative source for Master ID ' + aliases[i][2] + '.');
          return;
        }
      }
    }

    for (let i = 1; i < eventData.length; i++) {
      const existing = rowObject_(eventHeaders, eventData[i]);
      const existingSource = normalizeUrl_(existing['Official source']);
      const sameSource = existingSource && (source === existingSource || submittedSource === existingSource);
      const sameNameDate =
        name &&
        normalizeEventName_(existing['Event']) === name &&
        dateKey_(existing['Start date']) === start &&
        String(existing['City'] || '').trim().toLowerCase() === candidateCity;

      if (sameSource || sameNameDate) {
        appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
          'Publication blocked: probable duplicate of Master ID ' + existing['ID'] + '.');
        return;
      }
    }

    const nextId = nextMasterId_(eventData, eventHeaders);
    const endDate = hasValue_(row['Proposed end date'])
      ? row['Proposed end date']
      : row['Proposed start date'];
    const eventName = String(row['Suggested event name']).trim();
    const city = String(row['Suggested city']).trim();
    const calendarTitle = String(row['Proposed calendar title'] || '').trim() ||
      (eventName + (city ? ' · ' + city : ''));

    const event = {
      'ID': nextId,
      'Start date': row['Proposed start date'],
      'End date': endDate,
      'Event': eventName,
      'City': city,
      'Country': String(row['Suggested country']).trim(),
      'Venue': String(row['Proposed venue'] || '').trim(),
      'Calendar': calendarName,
      'Organised by': calendarName === 'Ecosystem' ? organisedBy : '',
      'Status': String(row['Proposed status']).trim().toUpperCase(),
      'Calendar title': calendarTitle,
      'Include in calendar': 'Yes',
      'Notes / issue': String(row['Proposed notes'] || '').trim(),
      'Official source': String(row['Proposed official source']).trim(),
      'Last verified': new Date(),
      'Full address': String(row['Proposed full address'] || '').trim(),
      'Latitude': '',
      'Longitude': ''
    };

    const output = eventsSheet.getRange(
      eventsSheet.getLastRow() + 1, 1, 1, eventsSheet.getLastColumn()
    );
    const ordered = Object.keys(eventHeaders)
      .sort((a, b) => eventHeaders[a] - eventHeaders[b])
      .map(header => Object.prototype.hasOwnProperty.call(event, header) ? event[header] : '');
    output.setValues([ordered]);

    submissionsSheet
      .getRange(rowNumber, subHeaders['Master ID'])
      .setValue(nextId);

    appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
      'Published to Events as Master ID ' + nextId + '.');
    try {
      recordEventAlias_(ss, row['url'], row['Proposed official source'], nextId, row['Submission ID']);
      recordDiscoveryLeads_(ss, row, nextId, 'Submission ' + row['Submission ID']);
    } catch (err) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Event published; discovery lead needs review: ' + String(err));
    }
  } finally {
    lock.releaseLock();
  }
}

function recordDuplicateSubmission_(submissionsSheet, rowNumber, subHeaders) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const row = rowObject_(subHeaders, submissionsSheet.getRange(rowNumber, 1, 1, submissionsSheet.getLastColumn()).getValues()[0]);
    const masterId = String(row['Matched Master ID'] || '').trim();
    if (!masterId) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Duplicate not recorded: fill Matched Master ID first.');
      return;
    }
    const ss = SpreadsheetApp.openById(SUBMISSION_APPROVAL.spreadsheetId);
    const eventsSheet = ss.getSheetByName(SUBMISSION_APPROVAL.eventsSheet);
    const headers = headerMap_(eventsSheet);
    const values = eventsSheet.getDataRange().getValues();
    const matching = values.slice(1).find(values => String(values[headers['ID'] - 1]).trim() === masterId);
    if (!matching) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Duplicate not recorded: Master ID ' + masterId + ' does not exist.');
      return;
    }
    const event = rowObject_(headers, matching);
    const reportedUrl = String(row['url'] || '').trim();
    try {
      recordEventAlias_(ss, reportedUrl, event['Official source'], masterId, row['Submission ID']);
    } catch (err) {
      appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
        'Duplicate source not recorded: ' + String(err));
      return;
    }
    recordDiscoveryLeads_(ss, {...row,
      'Suggested event name': row['Suggested event name'] || event['Event'],
      'Suggested country': row['Suggested country'] || event['Country'],
      'Suggested city': row['Suggested city'] || event['City'],
      'Proposed official source': reportedUrl || event['Official source']
    }, masterId, 'Duplicate submission ' + row['Submission ID']);
    appendReviewNote_(submissionsSheet, rowNumber, subHeaders,
      'Duplicate linked to Master ID ' + masterId + '; source and sweep cue recorded.');
  } finally {
    lock.releaseLock();
  }
}

function recordEventAlias_(ss, reportedUrl, primaryUrl, masterId, submissionId) {
  const alias = normalizeUrl_(reportedUrl);
  if (!alias || alias === normalizeUrl_(primaryUrl)) return;
  const sources = ss.getSheetByName('Event Sources');
  if (!sources) throw new Error('Event Sources sheet is missing.');
  const existing = sources.getDataRange().getValues().slice(1)
    .find(values => String(values[0]) === alias);
  if (existing && String(existing[2]) !== String(masterId)) {
    throw new Error('URL already belongs to Master ID ' + existing[2]);
  }
  if (!existing) sources.appendRow([alias, String(reportedUrl).trim(), String(masterId),
    String(submissionId || ''), new Date(), 'Reviewed alternative event URL']);
}

function recordDiscoveryLeads_(ss, row, masterId, origin) {
  const sheet = ss.getSheetByName('Discovery Leads');
  if (!sheet) throw new Error('Discovery Leads sheet is missing.');
  const geography = [row['Suggested country'], row['Suggested city']].map(x => String(x || '').trim()).filter(Boolean).join(' / ');
  const source = String(row['Proposed official source'] || row['url'] || '').trim();
  const cues = [
    ['Similar event', String(row['Suggested event name'] || '').replace(/\b20\d{2}\b/g, '').trim()],
    ['Organiser', String(row['Suggested organiser'] || '').trim()],
    ['Topic', String(row['Sweep cue'] || '').trim()]
  ].filter(([, cue]) => cue);
  const known = sheet.getDataRange().getValues().slice(1);
  cues.forEach(([type, cue]) => {
    const duplicate = known.some(values =>
      String(values[1]) === type && String(values[2]).trim().toLowerCase() === cue.toLowerCase() &&
      String(values[4]).trim().toLowerCase() === geography.toLowerCase());
    if (!duplicate) {
      const leadId = 'SUB-' + String(row['Submission ID'] || masterId) + '-' + type.toUpperCase().replace(/[^A-Z]/g, '');
      sheet.appendRow([leadId, type, cue, source, geography, origin, 'WATCH', '', '', '',
        'Search official sources for the next edition and similar events in other European hubs; check Events and Event Sources before proposing a new master row.']);
    }
  });
}

function normalizeEventName_(value) {
  return String(value || '').toLowerCase().replace(/\b20\d{2}\b/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) map[key] = i + 1;
  });
  return map;
}

function rowObject_(headerMap, values) {
  const obj = {};
  Object.entries(headerMap).forEach(([header, col]) => {
    obj[header] = values[col - 1];
  });
  return obj;
}

function nextMasterId_(eventData, eventHeaders) {
  const idCol = eventHeaders['ID'];
  let maxId = 0;
  for (let i = 1; i < eventData.length; i++) {
    const n = Number(eventData[i][idCol - 1]);
    if (Number.isFinite(n)) maxId = Math.max(maxId, n);
  }
  return String(maxId + 1);
}

function appendReviewNote_(sheet, rowNumber, headers, message) {
  const col = headers['Review notes'];
  if (!col) return;
  const cell = sheet.getRange(rowNumber, col);
  const current = String(cell.getValue() || '').trim();
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
  cell.setValue((current ? current + '\n' : '') + '[' + stamp + '] ' + message);
}

function hasValue_(value) {
  return value instanceof Date || String(value == null ? '' : value).trim() !== '';
}

function dateKey_(value) {
  if (value instanceof Date && !isNaN(value)) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(value || '').trim().slice(0, 10);
}

function normalizeUrl_(value) {
  let s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/#.*$/, '');
  const parts = s.split('?');
  const query = (parts[1] || '').split('&').filter(param => param &&
    !/^(utm_[^=]*|fbclid|gclid|mc_cid|mc_eid)=/.test(param)).sort().join('&');
  return parts[0].replace(/\/+$/, '') + (query ? '?' + query : '');
}
