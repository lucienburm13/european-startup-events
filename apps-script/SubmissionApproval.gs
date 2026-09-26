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
 * - Blocks exact-source and same-name/date duplicates.
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
  if (decision !== 'APPROVE') return;

  publishApprovedSubmission_(sh, e.range.getRow(), headers);
}

function publishApprovedSubmission_(submissionsSheet, rowNumber, subHeaders) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const width = submissionsSheet.getLastColumn();
    const values = submissionsSheet.getRange(rowNumber, 1, 1, width).getValues()[0];
    const row = rowObject_(subHeaders, values);

    if (String(row['Master ID'] || '').trim()) return;

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
    const name = String(row['Suggested event name'] || '').trim().toLowerCase();
    const start = dateKey_(row['Proposed start date']);

    for (let i = 1; i < eventData.length; i++) {
      const existing = rowObject_(eventHeaders, eventData[i]);
      const existingSource = normalizeUrl_(existing['Official source']);
      const sameSource = source && existingSource && source === existingSource;
      const sameNameDate =
        name &&
        String(existing['Event'] || '').trim().toLowerCase() === name &&
        dateKey_(existing['Start date']) === start;

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
  } finally {
    lock.releaseLock();
  }
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
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '');
  return s.replace(/\/$/, '');
}
