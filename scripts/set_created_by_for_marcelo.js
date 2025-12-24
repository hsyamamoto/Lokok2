const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

// Goal: For every record where Manager-like fields mention Marcelo,
// set Created_By_User_Email to 'marcelogalvis@mylokok.com'.

const TARGET_EMAIL = 'marcelogalvis@mylokok.com';
const TARGET_NAME = 'Marcelo';

function nowStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) + '-' +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds())
  );
}

function normalize(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().toLowerCase();
}

function isMarceloMention(str) {
  const s = normalize(str);
  if (!s) return false;
  if (s.includes('marcelogalvis@mylokok.com')) return true;
  // tokens like "Marcelo", "marcelo"
  if (s.includes('marcelo')) return true;
  return false;
}

// Try to get a value from multiple candidate headers
function getFieldFromRow(row, headerMap, candidates) {
  for (const cand of candidates) {
    const key = headerMap[cand] || cand;
    if (row[key] !== undefined && row[key] !== null) return row[key];
    // Also try relaxed matching: exact header present
    if (row[cand] !== undefined && row[cand] !== null) return row[cand];
  }
  return undefined;
}

// Ensure header exists: if missing, add with undefined; returns key used
function ensureHeader(headers, headerMap, desiredKey) {
  // If any alias exists, prefer it
  const existing = headerMap[desiredKey];
  if (existing) return existing;
  // Otherwise, add the desiredKey
  if (!headers.includes(desiredKey)) headers.push(desiredKey);
  headerMap[desiredKey] = desiredKey;
  return desiredKey;
}

function buildHeaderMap(headers) {
  const map = {};
  // Normalize a few common variants into canonical keys
  const canonical = {
    'Manager': ['Manager', 'Gerente', 'Responsable', 'Responsável', 'Buyer', 'Assigned', 'Responsable/Manager'],
    'Created By User Email': ['Created By User Email', 'Created_By_User_Email', 'Created Email', 'CreatedByEmail'],
    'Created By User Name': ['Created By User Name', 'Created_By_User_Name', 'Created Name', 'CreatedByName'],
  };

  headers.forEach((h) => {
    // Exact mapping
    if (!map[h]) map[h] = h;
    // Try to attach to canonical groups
    for (const [canon, aliases] of Object.entries(canonical)) {
      if (aliases.map(normalize).includes(normalize(h))) {
        // prefer first seen header as representative
        if (!map[canon]) map[canon] = h;
      }
    }
  });

  // Guarantee canonical keys exist in the map (even if missing in headers)
  for (const canon of Object.keys(canonical)) {
    if (!map[canon]) map[canon] = canon;
  }

  return map;
}

function updateWorkbook(workbookPath) {
  if (!fs.existsSync(workbookPath)) {
    throw new Error(`Excel not found: ${workbookPath}`);
  }

  const backupPath = path.join(
    path.dirname(workbookPath),
    `cached_spreadsheet.backup-${nowStamp()}.xlsx`
  );
  fs.copyFileSync(workbookPath, backupPath);

  const wb = XLSX.readFile(workbookPath, { cellDates: true });
  let totalUpdated = 0;
  let sheetsTouched = 0;

  wb.SheetNames.forEach((sheetName) => {
    const ws = wb.Sheets[sheetName];
    if (!ws) return;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
    if (!rows || rows.length === 0) return;
    const headers = Object.keys(rows[0]);
    const headerMap = buildHeaderMap(headers);

    let updatedInSheet = 0;
    const updatedRows = rows.map((row) => {
      // Compose manager-like field string for mention detection
      const managerCandidates = [
        headerMap['Manager'],
        'Responsable',
        'Responsável',
        'Buyer',
        'Assigned',
        'Responsable/Manager',
      ].filter(Boolean);

      let composite = '';
      for (const mk of managerCandidates) {
        if (row[mk]) {
          composite += ' ' + String(row[mk]);
        }
      }

      const mentionsMarcelo = isMarceloMention(composite);
      if (!mentionsMarcelo) return row; // no change

      // Ensure target headers exist
      const createdEmailKey = ensureHeader(headers, headerMap, 'Created By User Email');
      // Optionally set name if present
      const createdNameKey = headerMap['Created By User Name'] || 'Created By User Name';
      if (!headers.includes(createdNameKey)) headers.push(createdNameKey);

      // Update values
      const currentEmail = row[createdEmailKey];
      if (normalize(currentEmail) !== normalize(TARGET_EMAIL)) {
        row[createdEmailKey] = TARGET_EMAIL;
        updatedInSheet++;
      }
      if (row[createdNameKey] !== TARGET_NAME) {
        row[createdNameKey] = TARGET_NAME;
      }
      return row;
    });

    if (updatedInSheet > 0) {
      sheetsTouched++;
      totalUpdated += updatedInSheet;
      const newWs = XLSX.utils.json_to_sheet(updatedRows, { skipHeader: false });
      // Preserve original header order as best as possible
      XLSX.utils.sheet_add_aoa(newWs, [Object.keys(updatedRows[0] || {})], { origin: 'A1' });
      wb.Sheets[sheetName] = newWs;
    }
  });

  XLSX.writeFile(wb, workbookPath);
  return { backupPath, totalUpdated, sheetsTouched };
}

function main() {
  const repoRoot = path.join(__dirname, '..');
  // Prefer root data directory
  const excelPath = path.join(repoRoot, 'data', 'cached_spreadsheet.xlsx');
  try {
    const { backupPath, totalUpdated, sheetsTouched } = updateWorkbook(excelPath);
    console.log(JSON.stringify({
      ok: true,
      excelPath,
      backupPath,
      totalUpdated,
      sheetsTouched,
      targetEmail: TARGET_EMAIL,
    }, null, 2));
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err.message) }));
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

