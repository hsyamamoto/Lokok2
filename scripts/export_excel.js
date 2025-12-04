const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function pickExisting(paths) {
  for (const p of paths) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function getExcelPath() {
  const root = process.cwd();
  const candidates = [
    process.env.EXCEL_PATH,
    path.join(root, 'data', 'cached_spreadsheet.xlsx'),
    path.join(root, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
    path.join(root, 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
    path.join(root, 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
    path.join(root, 'Lokok2', 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
    path.join(root, 'Lokok2', 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
  ].filter(Boolean);
  return pickExisting(candidates);
}

function getSheetNameForCountry(country) {
  const c = String(country || '').toUpperCase();
  if (c === 'CA') return 'Wholesale CANADA';
  if (c === 'MX') return 'Wholesale MEXICO';
  if (c === 'CN') return 'Wholesale CHINA';
  return 'Wholesale LOKOK';
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

function main() {
  const countryArg = process.argv[2] || 'US';
  const country = String(countryArg).toUpperCase();

  const excelPath = getExcelPath();
  if (!excelPath) {
    console.error('❌ Nenhum arquivo Excel encontrado (cached_spreadsheet.xlsx ou Wholesale...).');
    process.exit(2);
  }

  console.log('📁 Usando Excel:', excelPath);
  const workbook = XLSX.readFile(excelPath);
  const targetSheet = getSheetNameForCountry(country);
  const sheetNames = workbook.SheetNames || [];

  if (!sheetNames.includes(targetSheet)) {
    console.error(`❌ Aba alvo não encontrada: ${targetSheet}. Abas disponíveis:`, sheetNames);
    process.exit(3);
  }

  const ws = workbook.Sheets[targetSheet];
  const data = XLSX.utils.sheet_to_json(ws);
  console.log(`✅ Registros lidos (${country}/${targetSheet}):`, data.length);

  // Determina cabeçalhos pela primeira linha ou união das chaves
  const baseHeaders = inferHeadersFromWorksheet(ws);
  const headerSet = new Set(baseHeaders);
  for (const rec of Array.isArray(data) ? data : []) {
    Object.keys(rec || {}).forEach(k => headerSet.add(k));
  }
  const headers = Array.from(headerSet);

  const rows = (Array.isArray(data) ? data : []).map(rec => {
    const row = {};
    for (const h of headers) {
      row[h] = rec && rec[h] !== undefined ? rec[h] : '';
    }
    return row;
  });

  const wbOut = XLSX.utils.book_new();
  const wsOut = XLSX.utils.json_to_sheet(rows, { header: headers });
  XLSX.utils.book_append_sheet(wbOut, wsOut, `Export_${country}`);

  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const outName = `lokok2-export-${country}-${y}${m}${d}.xlsx`;
  const outPath = path.join(process.cwd(), 'data', outName);

  try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch (_) {}
  XLSX.writeFile(wbOut, outPath);
  console.log('📝 Arquivo gerado:', outPath);
}

main();