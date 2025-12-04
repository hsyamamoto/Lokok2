const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function readSheetRows(xlsxPath, sheetName) {
  if (!fs.existsSync(xlsxPath)) {
    throw new Error(`Arquivo Excel não encontrado: ${xlsxPath}`);
  }
  const wb = XLSX.readFile(xlsxPath);
  const names = wb.SheetNames || [];
  if (!names.includes(sheetName)) {
    throw new Error(`Aba '${sheetName}' não encontrada em ${xlsxPath}. Abas: ${names.join(', ')}`);
  }
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws);
  return { rows, ws };
}

function inferHeadersFromWorksheet(ws) {
  try {
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
    const headerRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : [];
    if (Array.isArray(headerRow) && headerRow.length > 0) return headerRow;
  } catch (_) {}
  return [
    'Name','Website','CATEGORÍA','Account Request Status','DATE','Responsable',
    'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)',
    'Description/Notes','Contact Name','Contact Phone','E-Mail','Address','User','PASSWORD',
    'LLAMAR','PRIO (1 - TOP, 5 - baixo)','Comments','Country','Created_By_User_ID','Created_By_User_Name','Created_At'
  ];
}

function stripDiacritics(str) {
  try { return ((str || '') + '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) { return ((str || '') + ''); }
}

function normalizeWebsite(url) {
  let s = ((url ?? '') + '').trim().toLowerCase();
  if (!s) return '';
  // Remover protocolo
  s = s.replace(/^https?:\/\//, '');
  // Remover credenciais
  s = s.replace(/^([^@]+@)/, '');
  // Remover www.
  s = s.replace(/^www\./, '');
  // Pegar somente host (até primeira barra, ?, #)
  s = s.split(/[\/#?]/)[0];
  // Remover trailing dots
  s = s.replace(/\.$/, '');
  return s;
}

function normalizeName(name) {
  const n = stripDiacritics(((name ?? '') + '').trim().toLowerCase());
  return n.replace(/\s+/g, ' ');
}

function toKey(rec) {
  const website = normalizeWebsite(rec.Website || rec['Website']);
  const name = normalizeName(rec.Name || rec['Company Name'] || rec['NAME']);
  if (website || name) return `w:${website}|n:${name}`;
  const addr = normalizeName(rec.Address);
  const city = normalizeName(rec.City);
  const state = normalizeName(rec.State);
  const email = ((rec['E-Mail'] ?? rec['Contact Email'] ?? '') + '').trim().toLowerCase();
  return `c:${addr}|${city}|${state}|${email}`;
}

function normalizeRows(rows, headers) {
  return (Array.isArray(rows) ? rows : []).map(rec => {
    const out = {};
    for (const h of headers) {
      out[h] = rec && rec[h] !== undefined ? rec[h] : '';
    }
    return out;
  });
}

function writeXlsx(rows, sheetName, outPath) {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch (_) {}
  XLSX.writeFile(wb, outPath);
}

function main() {
  // Base (1048): Lokok2/data/cached_spreadsheet.xlsx, aba US
  const basePath = path.join(process.cwd(), 'Lokok2', 'data', 'cached_spreadsheet.xlsx');
  const baseSheet = 'Wholesale LOKOK';

  // Target (1109): data/lokok2-export-US-20251119.xlsx, aba Export_US
  const targetPath = path.join(process.cwd(), 'data', 'lokok2-export-US-20251119.xlsx');
  const targetSheet = 'Export_US';

  console.log('📥 Lendo BASE (1048):', basePath, 'aba:', baseSheet);
  const { rows: rowsBase, ws: wsBase } = readSheetRows(basePath, baseSheet);
  console.log('✅ Registros BASE:', rowsBase.length);

  console.log('📥 Lendo TARGET (1109):', targetPath, 'aba:', targetSheet);
  const { rows: rowsTarget, ws: wsTarget } = readSheetRows(targetPath, targetSheet);
  console.log('✅ Registros TARGET:', rowsTarget.length);

  // Cabeçalhos unificados para escrita
  const baseHeaders = inferHeadersFromWorksheet(wsBase);
  const targetHeaders = inferHeadersFromWorksheet(wsTarget);
  const headerSet = new Set([...baseHeaders, ...targetHeaders]);
  for (const r of rowsBase) Object.keys(r).forEach(k => headerSet.add(k));
  for (const r of rowsTarget) Object.keys(r).forEach(k => headerSet.add(k));
  const headers = Array.from(headerSet);

  const normBase = normalizeRows(rowsBase, headers);
  const normTarget = normalizeRows(rowsTarget, headers);

  // Multiconjunto: considerar multiplicidade por chave
  const countBase = new Map();
  for (const r of normBase) {
    const k = toKey(r);
    countBase.set(k, (countBase.get(k) || 0) + 1);
  }
  const diff = [];
  for (const r of normTarget) {
    const k = toKey(r);
    const cnt = countBase.get(k) || 0;
    if (cnt > 0) {
      countBase.set(k, cnt - 1); // consome uma ocorrência
    } else {
      diff.push(r);
    }
  }
  console.log('🧮 Diferença (TARGET - BASE, multiset):', diff.length);

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  const outDiff = path.join(process.cwd(), 'data', `lokok2-diff-1109-minus-1048-US-multiset-${diff.length}-${y}${m}${d}.xlsx`);
  console.log('📝 Gravando diff em:', outDiff);
  writeXlsx(diff, 'Diff_1109_minus_1048_US', outDiff);

  console.log('✅ Concluído.');
}

try {
  main();
} catch (e) {
  console.error('❌ Falha na dif. 1109 vs 1048:', e.message);
  process.exit(1);
}