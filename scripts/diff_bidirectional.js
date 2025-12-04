const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');

function readSheet(filePath, sheetName) {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Aba '${sheetName}' não encontrada em '${filePath}'.`);
  return XLSX.utils.sheet_to_json(ws, { defval: '' });
}

function stripDiacritics(str) {
  try { return ((str || '') + '').normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (_) { return ((str || '') + ''); }
}

function normalizeWebsite(url) {
  let s = ((url ?? '') + '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^https?:\/\//, '');
  s = s.replace(/^([^@]+@)/, '');
  s = s.replace(/^www\./, '');
  s = s.split(/[\/#?]/)[0];
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

function multisetDiff(targetRows, baseRows) {
  const countBase = new Map();
  for (const r of baseRows) {
    const k = toKey(r);
    countBase.set(k, (countBase.get(k) || 0) + 1);
  }
  const onlyTarget = [];
  let matched = 0;
  for (const r of targetRows) {
    const k = toKey(r);
    const cnt = countBase.get(k) || 0;
    if (cnt > 0) {
      countBase.set(k, cnt - 1);
      matched += 1;
    } else {
      onlyTarget.push(r);
    }
  }
  return { onlyTarget, matched };
}

function unionHeaders(rowsA, rowsB) {
  const keys = new Set();
  [...rowsA, ...rowsB].forEach(r => Object.keys(r).forEach(k => keys.add(k)));
  return [...keys];
}

function writeExcel(outPath, sheetName, rows, headers) {
  const ordered = rows.map(r => {
    const o = {};
    headers.forEach(h => { o[h] = r[h] ?? ''; });
    return o;
  });
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(ordered);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, outPath);
}

function main() {
  const basePath = path.join(process.cwd(), 'data', 'cached_spreadsheet.xlsx');
  const baseSheet = 'Wholesale LOKOK';
  const targetPath = path.join(process.cwd(), 'data', 'lokok2-export-US-20251119.xlsx');
  const targetSheet = 'Export_US';

  const base = readSheet(basePath, baseSheet);
  const target = readSheet(targetPath, targetSheet);
  const ymd = new Date();
  const y = ymd.getFullYear();
  const m = String(ymd.getMonth() + 1).padStart(2, '0');
  const d = String(ymd.getDate()).padStart(2, '0');

  const { onlyTarget: bMinusA, matched: matchedBA } = multisetDiff(target, base);
  const { onlyTarget: aMinusB, matched: matchedAB } = multisetDiff(base, target);

  const headers = unionHeaders(bMinusA, aMinusB);

  const outBminusA = path.join(process.cwd(), 'data', `lokok2-diff-1109-minus-1048-US-multiset-${bMinusA.length}-${y}${m}${d}.xlsx`);
  writeExcel(outBminusA, 'US_1109_minus_1048', bMinusA, headers);

  const outAminusB = path.join(process.cwd(), 'data', `lokok2-diff-1048-minus-1109-US-multiset-${aMinusB.length}-${y}${m}${d}.xlsx`);
  writeExcel(outAminusB, 'US_1048_minus_1109', aMinusB, headers);

  const stats = {
    base_count: base.length,
    target_count: target.length,
    matched_from_target: matchedBA,
    matched_from_base: matchedAB,
    b_minus_a_count: bMinusA.length,
    a_minus_b_count: aMinusB.length,
  };
  const outStats = path.join(process.cwd(), 'data', `lokok2-diff-stats-US-${y}${m}${d}.json`);
  fs.writeFileSync(outStats, JSON.stringify(stats, null, 2), 'utf8');
  console.log('Diferenças salvas:', path.basename(outBminusA), path.basename(outAminusB));
  console.log('Estatísticas:', stats);
}

main();