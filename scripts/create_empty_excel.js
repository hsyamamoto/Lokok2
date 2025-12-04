const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

/**
 * Gera um Excel vazio com as abas esperadas pelo app:
 * - "Wholesale LOKOK" (US)
 * - "Wholesale CHINA" (CN)
 * As abas ficam sem registros (apenas criadas). O app lerá 0 linhas.
 */
function createEmptyWorkbook(outputPath) {
  // Cria workbook novo
  const wb = XLSX.utils.book_new();

  // Cria uma aba vazia (sem cabeçalhos)
  const emptyAoA = [];
  const wsUS = XLSX.utils.aoa_to_sheet(emptyAoA);
  const wsCN = XLSX.utils.aoa_to_sheet(emptyAoA);

  // Adiciona ao workbook com os nomes esperados
  XLSX.utils.book_append_sheet(wb, wsUS, 'Wholesale LOKOK');
  XLSX.utils.book_append_sheet(wb, wsCN, 'Wholesale CHINA');

  // Garante diretório
  const dir = path.dirname(outputPath);
  fs.mkdirSync(dir, { recursive: true });

  // Escreve arquivo
  XLSX.writeFile(wb, outputPath);
}

function main() {
  const out = path.join(process.cwd(), 'data', 'empty-reset.xlsx');
  createEmptyWorkbook(out);
  console.log('✅ Planilha vazia gerada em:', out);
  console.log('   Abas: "Wholesale LOKOK" (US) e "Wholesale CHINA" (CN), 0 registros.');
  console.log('   Para usar em produção, aponte EXCEL_PATH para este arquivo e redeploy.');
}

if (require.main === module) {
  main();
}