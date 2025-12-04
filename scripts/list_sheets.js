const XLSX = require('xlsx');
const fs = require('fs');

function main() {
  const excelPath = process.env.EXCEL_PATH;
  if (!excelPath || !fs.existsSync(excelPath)) {
    console.error('EXCEL_PATH não definido ou arquivo inexistente:', excelPath);
    process.exit(1);
  }
  const wb = XLSX.readFile(excelPath);
  const names = wb.SheetNames;
  const report = [];
  for (const name of names) {
    const ws = wb.Sheets[name];
    const rows = XLSX.utils.sheet_to_json(ws);
    report.push({ sheet: name, rows: rows.length });
  }
  console.log(JSON.stringify({ sheets: report }, null, 2));
}

main();