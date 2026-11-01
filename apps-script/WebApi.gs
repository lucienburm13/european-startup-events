/**
 * Optional public website API for European Startup Events.
 * Add this file to the same Apps Script project as Code.gs, then deploy as a Web app.
 * Execute as: Me. Access: Anyone.
 */
function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || 'events';
    const prefix = (e && e.parameter && e.parameter.prefix) || '';
    if (action !== 'events') return jsonResponse_({ ok: false, error: 'Unknown action' }, prefix);
    return jsonResponse_({ ok: true, generatedAt: new Date().toISOString(), events: websiteEvents_() }, prefix);
  } catch (err) {
    const prefix = (e && e.parameter && e.parameter.prefix) || '';
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) }, prefix);
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (payload.action !== 'submitEvent') return jsonResponse_({ ok: false, error: 'Unknown action' });
    const sheet = ensureSubmissionsSheet_();
    const now = new Date();
    const id = Utilities.getUuid();
    sheet.appendRow([
      id, now, 'NEW', cleanText_(payload.url), cleanText_(payload.name), cleanText_(payload.dates),
      cleanText_(payload.location), cleanText_(payload.email), cleanText_(payload.notes), '', '', ''
    ]);
    return jsonResponse_({ ok: true, submissionId: id });
  } catch (err) {
    return jsonResponse_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function websiteEvents_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  const sh = ss.getSheetByName(CONFIG.eventsSheet);
  const values = sh.getDataRange().getDisplayValues();
  const headers = values.shift();
  const ix = {};
  headers.forEach((h, i) => ix[h] = i);
  return values
    .filter(r => String(r[ix['Include in calendar']] || '').trim().toLowerCase() === 'yes')
    .map(r => ({
      id: r[ix['ID']],
      start: r[ix['Start date']],
      end: r[ix['End date']],
      name: r[ix['Event']],
      city: r[ix['City']],
      country: r[ix['Country']],
      venue: r[ix['Venue']],
      calendar: r[ix['Calendar']],
      organisedBy: ix['Organised by'] == null ? '' : r[ix['Organised by']],
      status: r[ix['Status']],
      title: r[ix['Calendar title']] || r[ix['Event']],
      notes: r[ix['Notes / issue']],
      source: r[ix['Official source']],
      lastVerified: r[ix['Last verified']],
      address: r[ix['Full address']],
      lat: ix['Latitude'] == null ? '' : r[ix['Latitude']],
      lng: ix['Longitude'] == null ? '' : r[ix['Longitude']]
    }));
}

function ensureSubmissionsSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.spreadsheetId);
  let sh = ss.getSheetByName('Submissions');
  if (sh) return sh;
  sh = ss.insertSheet('Submissions');
  sh.getRange(1, 1, 1, 12).setValues([[
    'Submission ID','Submitted at','Status','URL','Event name','Dates','Location','Submitter email','Submitter notes','Review notes','Decision','Master ID'
  ]]);
  sh.setFrozenRows(1);
  return sh;
}

function cleanText_(value) {
  return String(value == null ? '' : value).trim().slice(0, 4000);
}

function jsonResponse_(obj, prefix) {
  const json = JSON.stringify(obj);
  if (prefix) {
    if (!/^[A-Za-z_$][0-9A-Za-z_$.]*$/.test(prefix)) {
      return ContentService.createTextOutput(JSON.stringify({ok:false,error:'Invalid callback'}))
        .setMimeType(ContentService.MimeType.JSON);
    }
    return ContentService.createTextOutput(prefix + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
