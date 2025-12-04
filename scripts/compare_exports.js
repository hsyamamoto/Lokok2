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

function toKey(rec) {
  const s = (v) => ((v ?? '') + '').trim().toLowerCase();
  // Chave preferencial: Website; fallback: Name; depois combinação básica
  const website = s(rec.Website);
  const name = s(rec.Name);
  if (website) return `w:${website}`;
  if (name) return `n:${name}`;
  const addr = s(rec.Address);
  const city = s(rec.City);
  const state = s(rec.State);
  return `c:${name}|${addr}|${city}|${state}`;
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
  // Caminhos e abas
  const appExcelPath = path.join(process.cwd(), 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');
  const appSheetName = 'Wholesale LOKOK'; // US
  const exportedPath = path.join(process.cwd(), 'data', 'lokok2-export-US-20251119.xlsx');
  const exportedSheetName = 'Export_US';

  // Ler A (versão do app) e B (export de 1109)
  console.log('📥 Lendo A (app):', appExcelPath, 'aba:', appSheetName);
  const { rows: rowsA, ws: wsA } = readSheetRows(appExcelPath, appSheetName);
  console.log('✅ Registros A:', rowsA.length);

  console.log('📥 Lendo B (export 1109):', exportedPath, 'aba:', exportedSheetName);
  const { rows: rowsB, ws: wsB } = readSheetRows(exportedPath, exportedSheetName);
  console.log('✅ Registros B:', rowsB.length);

  // Cabeçalhos unificados
  const baseA = inferHeadersFromWorksheet(wsA);
  const baseB = inferHeadersFromWorksheet(wsB);
  const headerSet = new Set([...baseA, ...baseB]);
  for (const r of rowsA) Object.keys(r).forEach(k => headerSet.add(k));
  for (const r of rowsB) Object.keys(r).forEach(k => headerSet.add(k));
  const headers = Array.from(headerSet);

  // Normalizar para escrita
  const normA = normalizeRows(rowsA, headers);
  const normB = normalizeRows(rowsB, headers);

  // Mapear chaves
  const setA = new Set(normA.map(toKey));
  const setB = new Set(normB.map(toKey));

  // Diferença: B \ A (registros presentes no 1109 que não estão no 1048)
  const diff = normB.filter(r => !setA.has(toKey(r)));
  console.log('🧮 Diferença (B - A):', diff.length);

  // Saídas
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');

  const out1048 = path.join(process.cwd(), 'data', `lokok2-export-US-1048-${y}${m}${d}.xlsx`);
  const outDiff = path.join(process.cwd(), 'data', `lokok2-diff-US-${diff.length}-${y}${m}${d}.xlsx`);

  console.log('📝 Gravando export-1048 em:', out1048);
  writeXlsx(normA, 'Export_US_1048', out1048);

  console.log('📝 Gravando diff em:', outDiff);
  writeXlsx(diff, 'Diff_US', outDiff);

  console.log('✅ Concluído.');
}

try {
  main();
} catch (e) {
  console.error('❌ Falha na comparação/exportação:', e.message);
  process.exit(1);
}