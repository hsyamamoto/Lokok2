/**
 * Analisa a distribuição de "manager" nos registros dos EUA (US) em suppliers_json.
 * - Conecta ao Postgres via `DATABASE_URL`.
 * - Busca apenas registros US usando aliases (us, usa, united states...).
 * - Extrai valor manager-like de campos (Responsable/Manager/Buyer...)
 * - Divide por separadores e normaliza nomes para contagem.
 * - Exporta `data/us_manager_distribution.json` e `data/us_manager_distribution.csv`.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function normalizeCountryAlias(v) {
  const s = String(v || '').trim().toLowerCase();
  if (!s) return null;
  if (['us','usa','united states','united states of america'].includes(s)) return 'US';
  return null;
}

function getManagerLikeValue(obj) {
  const rec = obj && obj.distributor && typeof obj.distributor === 'object' ? obj.distributor : obj;
  const candidates = [
    'Responsable','Manager','Buyer',
    'Responsable Buyer','Responsible Buyer','Buyer Responsable','Buyer Responsible',
    'Assigned','Assigned To','Assigned_To','AssignedTo',
    'Purchase Manager','Purchasing Manager','Purchasing Buyer','Buyer Manager'
  ];
  for (const k of candidates) {
    const v = rec?.[k];
    if (v != null && String(v).trim().length > 0) return v;
  }
  // Fallback: agrega múltiplos campos para não perder informação
  const agg = [];
  for (const k of candidates) { const v = rec?.[k]; if (v) agg.push(String(v)); }
  const createdName = rec?.['Created_By_User_Name'];
  if (createdName) agg.push(String(createdName));
  return agg.join(' | ');
}

function splitManagers(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  // Divide por separadores comuns
  const parts = s
    .split(/\s*[\|;,\/&]+\s|\s+and\s+|\s+y\s+/i)
    .map(t => String(t).trim())
    .filter(Boolean);
  return parts;
}

function toKey(name) {
  const s = String(name || '').trim().toLowerCase();
  // Remove aspas e pontuação simples
  return s.replace(/["'`]+/g, '').replace(/\s+/g, ' ');
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const s = String(val);
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

async function main() {
  const conn = process.env.DATABASE_URL;
  if (!conn) {
    console.error('DATABASE_URL não definido. Configure para conectar no Postgres.');
    process.exit(2);
  }

  const pool = new Pool({ connectionString: conn });
  let rows;
  try {
    // Filtrar diretamente os US via aliases na consulta
    const aliases = ['us','usa','united states','united states of america'];
    const res = await pool.query(
      `SELECT id, country, data
       FROM suppliers_json
       WHERE LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = ANY($1)`,
      [aliases]
    );
    rows = res.rows || [];
    console.log(`Registros US carregados: ${rows.length}`);
  } catch (err) {
    console.error('Falha ao consultar suppliers_json (US):', err.message);
    process.exit(3);
  }

  const counts = new Map(); // key(lower) -> { count, samples: Set }
  let blankCount = 0;

  for (const r of rows) {
    const d = r.data || {};
    const managerRaw = getManagerLikeValue(d);
    const tokens = splitManagers(managerRaw);
    if (tokens.length === 0) {
      blankCount++;
      continue;
    }
    for (const t of tokens) {
      const key = toKey(t);
      if (!key) continue;
      const rec = counts.get(key) || { count: 0, samples: new Set() };
      rec.count += 1;
      rec.samples.add(t);
      counts.set(key, rec);
    }
  }

  // Ordenar por contagem desc
  const sorted = Array.from(counts.entries())
    .map(([key, obj]) => ({ key, count: obj.count, sample: Array.from(obj.samples)[0] || key }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const jsonOut = {
    generatedAt: new Date().toISOString(),
    totalUS: rows.length,
    blankManagers: blankCount,
    uniqueManagers: sorted.length,
    topManagers: sorted.slice(0, 100) // limitar para leitura rápida
  };

  const jsonPath = path.join(process.cwd(), 'data', 'us_manager_distribution.json');
  fs.writeFileSync(jsonPath, JSON.stringify(jsonOut, null, 2), 'utf8');
  console.log(`JSON gerado: ${jsonPath}`);

  // CSV completo: manager (sample) e count
  const csvPath = path.join(process.cwd(), 'data', 'us_manager_distribution.csv');
  const headers = ['manager_sample','count'];
  const lines = [headers.join(',')];
  for (const item of sorted) {
    lines.push([csvEscape(item.sample), String(item.count)].join(','));
  }
  fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
  console.log(`CSV gerado: ${csvPath}`);

  await pool.end();
}

main().catch((err) => {
  console.error('Erro no analisador de distribuição US:', err);
  process.exit(1);
});

