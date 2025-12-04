const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Corrige cabeçalhos para o bulk-upload exigindo "Name" e "CATEGORÍA".
 * - Mapeia variantes comuns: CATEGORIA/Categoria/Category → CATEGORÍA
 * - Mantém demais campos conforme existentes
 * Usage: node scripts/fix_headers_for_bulk_upload.js [input.xlsx] [output.xlsx]
 */
(function main() {
  const inputArg = process.argv[2] || path.join(__dirname, '..', 'data', 'lokok2-export-US-20251119.xlsx');
  const outputArg = process.argv[3] || path.join(__dirname, '..', 'data', 'lokok2-export-US-20251119.fixed.xlsx');

  if (!fs.existsSync(inputArg)) {
    console.error('Input Excel não encontrado:', inputArg);
    process.exit(1);
  }

  try {
    const wb = XLSX.readFile(inputArg);
    const sheetName = wb.SheetNames[0];
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

    const normalized = [];
    let requiredOk = 0;
    let requiredMissing = 0;

    for (const r of rows) {
      const out = {};
      // Name
      out['Name'] = r['Name'] || r['Company Name'] || r['Empresa'] || r['Nome'] || '';
      // Category → CATEGORÍA
      out['CATEGORÍA'] = r['CATEGORÍA'] || r['CATEGORIA'] || r['Categoria'] || r['Category'] || '';
      // Pass through common fields
      out['Website'] = r['Website'] || r['Site'] || '';
      out['Account Request Status'] = r['Account Request Status'] || r['Account Status'] || '';
      out['DATE'] = r['DATE'] || r['Date'] || '';
      out['Responsable'] = r['Responsable'] || r['Manager'] || '';
      const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
      out[STATUS_HEADER] = r[STATUS_HEADER] || r['Status'] || '';
      out['Description/Notes'] = r['Description/Notes'] || r['Description'] || '';
      out['Contact Name'] = r['Contact Name'] || '';
      out['Contact Phone'] = r['Contact Phone'] || '';
      out['E-Mail'] = r['E-Mail'] || r['Contact Email'] || '';
      out['Address'] = r['Address'] || '';
      out['User'] = r['User'] || '';
      out['PASSWORD'] = r['PASSWORD'] || '';
      out['LLAMAR'] = r['LLAMAR'] || '';
      out['PRIO (1 - TOP, 5 - bajo)'] = r['PRIO (1 - TOP, 5 - bajo)'] || r['Priority'] || '';
      out['Comments'] = r['Comments'] || '';

      if (out['Name'] && out['CATEGORÍA']) requiredOk++; else requiredMissing++;
      normalized.push(out);
    }

    const wsOut = XLSX.utils.json_to_sheet(normalized);
    const wbOut = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbOut, wsOut, 'Suppliers');
    XLSX.writeFile(wbOut, outputArg);

    console.log('Arquivo corrigido gerado:', outputArg);
    console.log('Linhas com campos obrigatórios OK:', requiredOk);
    console.log('Linhas com campos obrigatórios ausentes:', requiredMissing);
  } catch (e) {
    console.error('Erro ao processar Excel:', e);
    process.exit(1);
  }
})();