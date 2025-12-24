// Import CSV into suppliers_json using upsertJsonSupplier
// Usage:
//   node scripts/import_csv_suppliers.js --file data/suppliers_marcelogalvis.csv --defaultCountry CA 
//     --userEmail marcelogalvis@mylokok.com --userName "Marcelo Galvis"

const fs = require('fs');
const path = require('path');
const {
  pool,
  upsertJsonSupplier,
  deduplicateSuppliersJson,
} = require('../database');

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.replace(/^--/, '');
      const val = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
      out[key] = val;
    }
  }
  return out;
}

function detectDelimiter(firstLine) {
  if (firstLine.includes('\t')) return '\t';
  return ',';
}

// Basic CSV/TSV parser supporting quoted fields and CRLF
function parseCSV(text, delimiter) {
  const rows = [];
  let cur = [];
  let field = '';
  let inQuotes = false;

  const len = text.length;
  for (let i = 0; i < len; i++) {
    const ch = text[i];
    const next = i + 1 < len ? text[i + 1] : '';

    if (inQuotes) {
      if (ch === '"' && next === '"') { // escaped quote
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        cur.push(field);
        field = '';
      } else if (ch === '\n') {
        // finalize row (handle \r\n)
        cur.push(field);
        rows.push(cur);
        cur = [];
        field = '';
      } else if (ch === '\r') {
        // skip, will be handled on \n
      } else {
        field += ch;
      }
    }
  }
  // finalize last field/row
  cur.push(field);
  rows.push(cur);

  // Remove trailing empty rows if any
  while (rows.length && rows[rows.length - 1].every(v => v === '')) {
    rows.pop();
  }
  return rows;
}

function toRecords(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map(h => String(h).trim());
  const records = [];
  for (let i = 1; i < rows.length; i++) {
    const line = rows[i];
    if (!line || line.every(v => String(v).trim() === '')) continue;
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j];
      let val = j < line.length ? line[j] : '';
      if (typeof val === 'string') {
        val = val.trim();
        // remove surrounding backticks if present: `value`
        if (val.startsWith('`') && val.endsWith('`')) {
          val = val.substring(1, val.length - 1).trim();
        }
      }
      obj[key] = val;
    }
    records.push(obj);
  }
  return records;
}

async function findUserByEmail(email) {
  if (!email) return null;
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT id, name, email FROM users WHERE email = $1 LIMIT 1', [email]);
    if (rows && rows[0]) return rows[0];
    return null;
  } catch (err) {
    console.warn('Aviso: falha ao buscar usuário por email:', err?.message || err);
    return null;
  } finally {
    client.release();
  }
}

async function main() {
  const args = parseArgs();
  const file = args.file || path.join(process.cwd(), 'data', 'suppliers_marcelogalvis.csv');
  const defaultCountry = args.defaultCountry || null;
  const userEmail = args.userEmail || 'marcelogalvis@mylokok.com';
  const userName = args.userName || 'Marcelo Galvis';

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL não está definido. Configure e tente novamente.');
    process.exit(1);
  }

  if (!fs.existsSync(file)) {
    console.error('Arquivo CSV não encontrado:', file);
    process.exit(1);
  }
  const content = fs.readFileSync(file, 'utf8');
  const firstLine = content.split(/\r?\n/)[0] || '';
  const delimiter = detectDelimiter(firstLine);
  const rows = parseCSV(content, delimiter);
  const records = toRecords(rows);

  const user = await findUserByEmail(userEmail);
  const createdByUser = { id: user?.id || null, name: user?.name || userName };

  let inserted = 0, updated = 0, failed = 0;
  for (const rec of records) {
    const country = rec.Country || rec['COUNTRY'] || defaultCountry || null;
    try {
      const result = await upsertJsonSupplier(rec, country, createdByUser);
      if (result.inserted) inserted++;
      else if (result.updated) updated++;
      else inserted++; // assume insert when no flags
    } catch (err) {
      failed++;
      console.error('Falha ao importar registro:', rec?.Name || rec?.Website || '[sem nome]', err?.message || err);
    }
  }

  let dedup = null;
  try {
    dedup = await deduplicateSuppliersJson();
  } catch (err) {
    console.warn('Deduplicação falhou (não crítica):', err?.message || err);
  }

  console.log('Importação concluída:', { inserted, updated, failed });
  if (dedup) console.log('Deduplicação:', dedup);
  process.exit(0);
}

main().catch(err => {
  console.error('Erro no import:', err?.message || err);
  process.exit(1);
});
