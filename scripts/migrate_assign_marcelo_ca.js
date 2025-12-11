// Migração: garantir que todos os registros do Canadá (CA)
// - tenham Country='CA'
// - incluam 'Marcelo' em Responsable (considera Manager/Buyer como fonte)
// - tenham Created_By_* apontando para Marcelo (opcionalmente força com --force-created-by)
// Uso:
//   Dry-run:  node scripts/migrate_assign_marcelo_ca.js [--all-sheets]
//   Aplicar:  node scripts/migrate_assign_marcelo_ca.js --apply [--force-created-by] [--all-sheets]

const GoogleDriveService = require('../googleDriveService');
const drive = new GoogleDriveService();

function normalize(s) {
  return String(s || '').trim().toUpperCase();
}

async function run(apply = false, forceCreatedBy = false, allSheets = false) {
  const country = 'CA';
  let dataCA = await drive.readSpreadsheetData(country);
  let dataUS = [];
  let dataMX = [];
  if (allSheets) {
    // Ler explicitamente cada aba para permitir contagem e atualização em lugar
    dataUS = await drive.readSpreadsheetData('US');
    dataMX = await drive.readSpreadsheetData('MX');
  }
  const total = Array.isArray(dataCA) ? dataCA.length : 0;

  let fixedCountry = 0;
  let updatedResponsable = 0;
  let updatedCreatedBy = 0;

  const marcelo = {
    id: 7,
    name: 'Marcelo',
    email: 'marcelogalvis@mylokok.com'
  };

  const updatedCA = (dataCA || []).map((rec) => {
    const out = { ...rec };

    // Garantir Country='CA'
    const curCountry = String(out.Country || out.country || '').trim().toUpperCase();
    if (curCountry !== country) {
      out.Country = country;
      fixedCountry++;
    }

    // Responsável: considera fonte em Responsable/Manager/Buyer, inclui Marcelo se não existir
    const managerRaw = ((out.Responsable || out.Manager || out.Buyer || '') + '').trim();
    const responsaveis = managerRaw ? managerRaw.split(',').map((s) => s.trim()) : [];
    const hasMarcelo = responsaveis.some((r) => normalize(r) === normalize(marcelo.name));
    if (!hasMarcelo) {
      responsaveis.push(marcelo.name);
      out.Responsable = responsaveis.join(', ');
      updatedResponsable++;
    } else {
      // Mantém Responsable consistente se a fonte original era Manager/Buyer
      if (!out.Responsable) out.Responsable = responsaveis.join(', ');
    }

    // Created_By_*: define Marcelo caso não esteja definido, ou força com flag
    const idOk = out.Created_By_User_ID && String(out.Created_By_User_ID).trim() === String(marcelo.id).trim();
    const nameOk = out.Created_By_User_Name && String(out.Created_By_User_Name).toLowerCase().includes(String(marcelo.name).toLowerCase());
    const emailOk = out.Created_By_User_Email && String(out.Created_By_User_Email).toLowerCase() === String(marcelo.email).toLowerCase();

    if (forceCreatedBy || !(idOk || nameOk || emailOk)) {
      out.Created_By_User_ID = marcelo.id;
      out.Created_By_User_Name = marcelo.name;
      out.Created_By_User_Email = marcelo.email;
      if (!out.Created_At) out.Created_At = new Date().toISOString();
      updatedCreatedBy++;
    }

    return out;
  });

  console.log(`[migrate] Total CA records: ${total}`);
  console.log(`[migrate] Country set to CA: ${fixedCountry}`);
  console.log(`[migrate] Responsable updated to include Marcelo: ${updatedResponsable}`);
  console.log(`[migrate] Created_By_* set to Marcelo: ${updatedCreatedBy}`);

  if (apply) {
    await drive.saveSpreadsheetData(updatedCA, country);
    console.log('[migrate] Saved changes to CA sheet.');
    if (allSheets) {
      // Atualizar também registros CA que estejam na aba US (se houver)
      let updatedUS = 0;
      const marcelo = { id: 7, name: 'Marcelo', email: 'marcelogalvis@mylokok.com' };
      const normalize = (s) => String(s || '').trim().toUpperCase();
      const usOut = (dataUS || []).map((rec) => {
        const out = { ...rec };
        const curCountry = String(out.Country || out.country || '').trim().toUpperCase();
        if (curCountry === country) {
          const managerRaw = ((out.Responsable || out.Manager || out.Buyer || '') + '').trim();
          const responsaveis = managerRaw ? managerRaw.split(',').map((s) => s.trim()) : [];
          const hasMarcelo = responsaveis.some((r) => normalize(r) === normalize(marcelo.name));
          if (!hasMarcelo) {
            responsaveis.push(marcelo.name);
            out.Responsable = responsaveis.join(', ');
          } else if (!out.Responsable) {
            out.Responsable = responsaveis.join(', ');
          }
          const idOk = out.Created_By_User_ID && String(out.Created_By_User_ID).trim() === String(marcelo.id).trim();
          const nameOk = out.Created_By_User_Name && String(out.Created_By_User_Name).toLowerCase().includes(String(marcelo.name).toLowerCase());
          const emailOk = out.Created_By_User_Email && String(out.Created_By_User_Email).toLowerCase() === String(marcelo.email).toLowerCase();
          if (forceCreatedBy || !(idOk || nameOk || emailOk)) {
            out.Created_By_User_ID = marcelo.id;
            out.Created_By_User_Name = marcelo.name;
            out.Created_By_User_Email = marcelo.email;
            if (!out.Created_At) out.Created_At = new Date().toISOString();
          }
          updatedUS++;
        }
        return out;
      });
      await drive.saveSpreadsheetData(usOut, 'US');
      console.log(`[migrate] Saved changes to US sheet for CA rows: ${updatedUS}`);
    }
  } else {
    console.log('[migrate] Dry-run only. Re-run with --apply to persist.');
    if (allSheets) {
      const countUS_CA = (dataUS || []).filter((r) => String(r.Country || r.country || '').trim().toUpperCase() === country).length;
      const countMX_CA = (dataMX || []).filter((r) => String(r.Country || r.country || '').trim().toUpperCase() === country).length;
      console.log(`[migrate] Breakdown — CA in US sheet: ${countUS_CA}, CA in MX sheet: ${countMX_CA}`);
    }
  }
}

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const forceCreatedBy = args.includes('--force-created-by');
const allSheets = args.includes('--all-sheets');

run(apply, forceCreatedBy, allSheets).catch((err) => {
  console.error('[migrate] Error:', err?.message || err);
  process.exit(1);
});
