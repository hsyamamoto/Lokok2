const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const GoogleDriveService = require('../googleDriveService');

function getArgValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

async function findSourcePath() {
  // Prefer explicit source path via CLI or env
  const cliSource = getArgValue('--source');
  const envSource = process.env.SOURCE_EXCEL_PATH;
  const preferred = cliSource || envSource;
  if (preferred) {
    if (fs.existsSync(preferred)) return preferred;
    console.warn(`⚠️ SOURCE_EXCEL_PATH informado não existe: ${preferred}`);
  }
  // Fall back to known cache/original paths
  const candidates = [
    path.join(__dirname, '..', 'data', 'cached_spreadsheet.xlsx'),
    path.join(__dirname, '..', 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
    path.join(__dirname, '..', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
    path.join(__dirname, '..', 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return p; } catch (_) {}
  }
  return null;
}

async function main() {
  console.log('🔧 Iniciando sincronização da aba "Wholesale LOKOK" para Google Sheets...');

  // Checa variáveis essenciais
  const spreadsheetId = process.env.GOOGLE_DRIVE_FILE_ID;
  const svcEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const svcKey = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!spreadsheetId) {
    console.error('❌ GOOGLE_DRIVE_FILE_ID não definido. Configure o ID da planilha.');
    process.exit(1);
  }
  if (!svcEmail || !svcKey) {
    console.warn('⚠️ Credenciais da service account não definidas (GOOGLE_SERVICE_ACCOUNT_EMAIL / GOOGLE_PRIVATE_KEY).');
    console.warn('   Compartilhe a planilha com a service account como Editor e defina as variáveis antes de executar.');
  }

  // Localiza fonte (arquivo informado ou cache)
  const sourcePath = await findSourcePath();
  if (!sourcePath) {
    console.error('❌ Não encontrei o arquivo fonte de Excel.');
    console.error('   Informe via --source "C:\\caminho\\arquivo.xlsx" ou defina SOURCE_EXCEL_PATH.');
    process.exit(1);
  }
  console.log(`📁 Usando fonte: ${sourcePath}`);

  const workbook = XLSX.readFile(sourcePath);

  async function writeTab(tabName, countryCode, useGid) {
    const ws = workbook.Sheets[tabName];
    if (!ws) {
      console.log(`ℹ️ Aba "${tabName}" não encontrada no arquivo fonte; pulando.`);
      return;
    }
    const data = XLSX.utils.sheet_to_json(ws);
    console.log(`📊 [${tabName}] Registros: ${data.length}`);
    if (data.length > 0) {
      console.log('🧩 Primeiro registro:', JSON.stringify(data[0]));
    }

    // Controla uso de GID: para US pode usar GID; para outras abas, ignorar GID
    const originalGid = process.env.GOOGLE_SHEET_GID;
    if (!useGid) {
      process.env.GOOGLE_SHEET_GID = '';
    }
    const drive = new GoogleDriveService();
    try {
      await drive.saveSpreadsheetData(data, countryCode);
      console.log(`✅ Gravado na aba destino (${tabName} / país ${countryCode})`);
    } catch (err) {
      console.error(`❌ Falha ao gravar aba ${tabName}:`, err?.message || err);
      process.env.GOOGLE_SHEET_GID = originalGid; // restaura
      throw err;
    }
    process.env.GOOGLE_SHEET_GID = originalGid; // restaura
  }

  // Empurra todas as abas conhecidas
  await writeTab('Wholesale LOKOK', 'US', true);
  await writeTab('Wholesale CANADA', 'CA', false);
  await writeTab('Wholesale MEXICO', 'MX', false);
  await writeTab('Wholesale CHINA', 'CN', false);

  console.log('🎉 Sincronização concluída para as abas disponíveis.');
}

main().catch((e) => {
  console.error('❌ Erro inesperado na sincronização:', e?.message || e);
  process.exit(1);
});