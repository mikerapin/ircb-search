/**
 * Serves the IRCB Schedule workbook's numbering columns as JSON, so CI can top up
 * data/episode-numbers.csv without a human downloading an xlsx every fortnight.
 *
 * Reads through the Sheets API advanced service rather than SpreadsheetApp, which is what
 * makes the grant read-only: SpreadsheetApp refuses to run under a .readonly scope and
 * demands read-write on every sheet the account can reach. The advanced service has no such
 * floor, and unlike a hand-rolled UrlFetchApp call it needs neither an auth header nor the
 * external_request scope -- and adding it from the Services menu switches the Sheets API on
 * in the script's Cloud project, which a raw REST call makes you do yourself in the console.
 *
 * Deploy (once, from the Google account that owns the workbook):
 *
 *   1. script.google.com -> New project, paste this file in over the myFunction stub.
 *   2. Editor sidebar -> + next to Services -> Google Sheets API, identifier "Sheets", Add.
 *   3. Project Settings -> tick "Show appsscript.json", then set:
 *
 *        "oauthScopes": ["https://www.googleapis.com/auth/spreadsheets.readonly"]
 *
 *   4. Project Settings -> Script Properties -> add TOKEN with a long random string.
 *   5. Deploy -> New deployment -> Web app, "Execute as: Me",
 *      "Who has access: Anyone". Take the /exec URL, not /dev.
 *   6. Put <deployment url>?token=<TOKEN> in the repo secret SCHEDULE_WEBAPP_URL.
 *
 * Narrowing oauthScopes stops the project *asking* for more; it does not withdraw a scope
 * already granted. To actually drop an earlier read-write grant, remove the project at
 * myaccount.google.com/permissions and authorize again.
 *
 * The deployment URL is unauthenticated, which is why TOKEN exists: without a match this
 * returns an error instead of the schedule. Rotating it is one field in Script Properties
 * plus one repo secret. Re-deploy as a *new version* after editing, or the URL keeps
 * serving the old code. Changing oauthScopes also needs a fresh authorization: run doGet
 * once from the editor to trigger the consent screen.
 *
 * It sends cells, not answers. Every rule about what the cells mean -- "Done" in the date
 * column, a fractional Ep marking a skipped week -- stays in scripts/schedule_numbers.py,
 * where it is already tested, so the two readers cannot drift apart.
 */
const SHEET_ID = '1MQE7ivVPbnxXWWi_N3SszNK12z6ZRKfje7QXkWvzvyw';

// Must match TABS in scripts/schedule_numbers.py: [tab name, its recording-date column].
const TABS = [['Old Recording Dates', 'Recording Date'], ['Schedule', 'Rec. Date']];

function doGet(e) {
  const want = PropertiesService.getScriptProperties().getProperty('TOKEN');
  const got = ((e && e.parameter) || {}).token;
  if (!want || got !== want) return json({error: 'bad or missing token'});

  try {
    // SERIAL_NUMBER asks for dates as the number the sheet actually stores, which removes
    // timezones from the problem rather than getting them right: a formatted date would be
    // rendered in some zone, and midnight anywhere east of Greenwich lands on the day before.
    const valueRanges = Sheets.Spreadsheets.Values.batchGet(SHEET_ID, {
      ranges: TABS.map(t => "'" + t[0] + "'!A:Z"),
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }).valueRanges || [];

    const rows = [];
    for (let t = 0; t < TABS.length; t++) {
      const [tab, datecol] = TABS[t];
      const values = (valueRanges[t] || {}).values;
      if (!values || !values.length) return json({error: 'no rows for tab: ' + tab});

      const header = values[0].map(c => String(c).trim());
      const iEp = header.indexOf('Ep');
      const iRec = header.indexOf(datecol);
      const iTopic = header.indexOf('Topic');
      if (iEp < 0 || iRec < 0) return json({error: 'no Ep/' + datecol + ' column in ' + tab});

      for (let r = 1; r < values.length; r++) {
        // The API omits trailing empty cells instead of padding, so a short row is normal
        // and every index has to be treated as possibly past the end. Over half the rows in
        // this workbook come back short.
        const row = values[r];
        const ep = cell(row, iEp);
        const rec = cell(row, iRec);
        rows.push({
          tab: tab,
          ep: ep === '' ? null : ep,
          rec: typeof rec === 'number' ? serialToDate(rec) : String(rec),
          topic: String(cell(row, iTopic)),
        });
      }
    }
    return json({sheet: SHEET_ID, dates: 'serial->yyyy-MM-dd', rows: rows});
  } catch (err) {
    // Losing read access must not look like a workbook with no rows in it. The advanced
    // service throws rather than returning a status, so this is where an API error lands.
    return json({error: String(err)});
  }
}

function cell(row, i) {
  return i < 0 || i >= row.length || row[i] === null || row[i] === undefined ? '' : row[i];
}

/** Sheets stores a date as days since 1899-12-30. Built and read in UTC, so it cannot drift. */
function serialToDate(serial) {
  const ms = Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000;
  return Utilities.formatDate(new Date(ms), 'UTC', 'yyyy-MM-dd');
}

function json(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
      .setMimeType(ContentService.MimeType.JSON);
}
