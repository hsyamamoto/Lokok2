const express = require('express');
const cookieSession = require('cookie-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { User } = require('./models/User');
const { DbUserRepository } = require('./models/UserDbRepository');
const { pool, initializeDatabase, getJsonSuppliers, insertJsonSupplier, deduplicateSuppliersJson, updateJsonSupplier, createJsonTable } = require('./database');
const http = require('http');
const https = require('https');
const axios = require('axios');
const XLSX = require('xlsx');

const app = express();
try { fs.mkdirSync('./logs', { recursive: true }); } catch {}
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRE_DB = (process.env.REQUIRE_DB === '1' || String(process.env.REQUIRE_DB || '').toLowerCase() === 'true');

// Serviço opcional do Google Drive (instanciado somente se configurado)
let googleDriveService = null;
try {
    const GoogleDriveService = require('./googleDriveService');
    if (process.env.GOOGLE_DRIVE_FILE_ID) {
        googleDriveService = new GoogleDriveService();
    }
} catch (e) {
    // Mantém nulo se módulo não existir ou falhar
    console.warn('[PRODUCTION DEBUG] GoogleDriveService não carregado:', e?.message || String(e));
}

function isGoogleDriveAvailable() {
    return (typeof googleDriveService !== 'undefined' && googleDriveService !== null && !!process.env.GOOGLE_DRIVE_FILE_ID);
}


function isDbEnabledForWrites() {
    const isProd = NODE_ENV === 'production';
    const dbConfigured = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
    return dbConfigured;
}

// Configuração do middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Configurar trust proxy para Railway
if (NODE_ENV === 'production') {
    app.set('trust proxy', 1);
    console.log('🔧 [PRODUCTION DEBUG] Trust proxy configurado para produção');
}

app.use(cookieParser());
app.use(cookieSession({
    name: 'lokok.sid',
    keys: [process.env.SESSION_SECRET || 'lokok-secret-key-2024'],
    maxAge: 24 * 60 * 60 * 1000, // 24 horas
    sameSite: NODE_ENV === 'production' ? 'lax' : 'lax',
    secure: NODE_ENV === 'production',
    httpOnly: true,
}));

// Middleware de debug para inspecionar headers de resposta
app.use((req, res, next) => {
    res.on('finish', () => {
        try {
            const setCookie = res.getHeader('Set-Cookie');
            const location = res.getHeader('Location');
            const debugObj = {
                path: req.path,
                method: req.method,
                statusCode: res.statusCode,
                location,
                setCookie
            };
            console.log('[PRODUCTION DEBUG] Resposta final:', debugObj);
            try {
                fs.appendFileSync('./logs/session-debug.log', `${new Date().toISOString()} ${JSON.stringify(debugObj)}\n`);
            } catch (fileErr) {
                // Ignorar erros de escrita em arquivo em ambientes sem permissão
            }
        } catch (e) {
            console.error('[PRODUCTION DEBUG] Erro ao inspecionar headers de resposta:', e);
        }
    });
    next();
});

console.log('🔧 [PRODUCTION DEBUG] Configuração de sessão:', {
    type: 'cookie-session',
    secure: NODE_ENV === 'production',
    httpOnly: true,
    sameSite: NODE_ENV === 'production' ? 'lax' : 'lax',
    trustProxy: NODE_ENV === 'production'
});

// Servir arquivos estáticos
app.use(express.static('public'));

// Evitar cache para páginas HTML em produção
app.use((req, res, next) => {
    const accept = String(req.headers.accept || '').toLowerCase();
    if (accept.includes('text/html')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
    }
    next();
});

// Fix de senhas controlado por ENV (aplica no banco de dados)
// Ao iniciar o servidor, se variáveis FIX_PWD_* estiverem definidas, atualiza a senha
// dos usuários-alvo diretamente no banco para consistência entre deploys.
async function applyEnvPasswordFixes() {
    // Permitir desabilitar por flag de ambiente
    if (String(process.env.DISABLE_ENV_PASSWORD_FIXES || '').toLowerCase() === 'true') {
        console.log('[PASSWORD FIX] Desabilitado por DISABLE_ENV_PASSWORD_FIXES=true');
        return;
    }
    try {
        const fixes = [
            { email: 'ignaciocortez@mylokok.com', env: (process.env.FIX_PWD_IGNACIO || process.env.FIX_PWD_NACHO) },
            { email: 'jeisonanteliz@mylokok.com', env: process.env.FIX_PWD_JEISON },
            { email: 'marcelogalvis@mylokok.com', env: process.env.FIX_PWD_MARCELO }
        ];
        const applied = [];
        for (const fix of fixes) {
            const newPwd = String(fix.env || '').trim();
            if (!newPwd) continue;
            const u = await userRepository.findByEmailAsync(fix.email);
            if (!u) {
                console.warn(`[PASSWORD FIX] Usuário não encontrado: ${fix.email}`);
                continue;
            }
            await userRepository.updatePasswordByEmailAsync(fix.email, newPwd);
            applied.push(fix.email);
        }
        if (applied.length > 0) {
            console.log(`[PASSWORD FIX] Aplicado para: ${applied.join(', ')}`);
        } else {
            console.log('[PASSWORD FIX] Nenhuma variável FIX_PWD_* definida. Sem alterações.');
        }
    } catch (e) {
        console.error('[PASSWORD FIX] Erro ao aplicar fixes de senha:', e?.message || e);
    }
}

// Healthcheck simples (informativo). O health detalhado está mais abaixo em '/health'.
app.get('/health-simple', (req, res) => {
    try {
        res.set('X-Server-File', __filename);
        res.set('X-Server-Dir', __dirname);
    } catch {}
    res.status(200).send(`OK - ${__filename}`);
});

// Health info simples (detalhado está mais abaixo em '/healthz')
app.get('/healthz-simple', (req, res) => {
    res.json({
        status: 'OK',
        serverFile: __filename,
        serverDir: __dirname,
        viewsDir: app.get('views')
    });
});

// Debug: listar rotas registradas no servidor atual (robusto, Express 4/5)
app.get('/debug/routes', (req, res) => {
    try {
        const routes = [];
        const debugLayers = [];
        const rootStack = app && app._router && Array.isArray(app._router.stack) ? app._router.stack : [];

        const traverse = (stack, prefix = '') => {
            for (const layer of stack) {
                // Rotas diretas (app.get/post/etc)
                if (layer && layer.route && layer.route.path) {
                    const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
                    routes.push({ path: prefix + layer.route.path, methods });
                    debugLayers.push({
                        kind: 'route',
                        name: layer.name,
                        path: prefix + layer.route.path,
                        methods
                    });
                }
                // Sub-routers (app.use('/base', router))
                else if (layer && layer.name === 'router' && layer.handle && Array.isArray(layer.handle.stack)) {
                    // Tentar obter o prefixo montado (Express não expõe caminho de forma estável em todas versões)
                    let mountPath = '';
                    try {
                        // Algumas versões expõem layer.regexp como /^\/base\/?(?=\/|$)/i
                        const rx = layer.regexp;
                        if (rx && rx.fast_star) {
                            mountPath = '*'; // fallback
                        } else if (rx && typeof rx.toString === 'function') {
                            const m = String(rx).match(/\^\\\/(.*?)\\\/?\(\?=\\\/+\|\$\)/);
                            if (m && m[1]) mountPath = '/' + m[1].replace(/\\\//g, '/');
                        }
                    } catch (_) {}
                    debugLayers.push({
                        kind: 'router',
                        name: layer.name,
                        mountPath: mountPath || '',
                        childCount: layer.handle.stack.length
                    });
                    traverse(layer.handle.stack, prefix + (mountPath || ''));
                }
                else {
                    // Middleware genérico
                    debugLayers.push({
                        kind: 'middleware',
                        name: layer && layer.name,
                        hasRoute: !!(layer && layer.route),
                        isRouter: !!(layer && layer.name === 'router')
                    });
                }
            }
        };

        traverse(rootStack);

        res.json({
            serverFile: __filename,
            serverDir: __dirname,
            routes,
            debug: {
                stackSize: rootStack.length,
                layerSamples: debugLayers.slice(0, 30)
            }
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Versão e diagnóstico rápido de build/paths
const BUILD_TIME = new Date().toISOString();
app.get('/version', (req, res) => {
    let version = 'unknown';
    try {
        const pkg = require(path.join(__dirname, 'package.json'));
        version = pkg.version || version;
    } catch (e) {}
    let viewsDir = app.get('views');
    let searchHasBadge = null;
    try {
        const fs = require('fs');
        const searchContent = fs.readFileSync(path.join(viewsDir, 'search.ejs'), 'utf8');
        searchHasBadge = searchContent.includes('v2025-12-15');
    } catch (e) {
        searchHasBadge = false;
    }
    res.json({
        version,
        buildTime: BUILD_TIME,
        nodeEnv: process.env.NODE_ENV || 'development',
        serverDir: __dirname,
        viewsDir,
        searchHasBadge
    });
});

// Rota rápida para identificar o arquivo do servidor em execução
app.get('/__whoami', (req, res) => {
    res.status(200).send(__filename);
});

// Diagnóstico: verificar se os templates contêm o badge esperado
app.get('/__template-version', (req, res) => {
    try {
        const viewsDir = app.get('views');
        const badge = 'v2025-12-24';
        const files = ['login.ejs', 'dashboard.ejs', 'form.ejs', 'search.ejs'];
        const results = {};
        for (const f of files) {
            const filePath = path.join(viewsDir, f);
            let exists = false;
            let hasBadge = false;
            let mtime = null;
            try {
                const stat = fs.statSync(filePath);
                exists = true;
                mtime = stat.mtime?.toISOString?.() || null;
                const content = fs.readFileSync(filePath, 'utf8');
                hasBadge = content.includes(badge);
            } catch (e) {
                exists = false;
            }
            results[f] = { exists, hasBadge, mtime };
        }
        res.json({
            viewsDir,
            badge,
            files: results
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Diagnóstico de runtime (para identificar qual servidor está rodando em produção)
app.get('/runtime', (req, res) => {
    try {
        res.json({
            pid: process.pid,
            nodeVersion: process.version,
            platform: process.platform,
            cwd: process.cwd(),
            serverFile: __filename,
            serverDir: __dirname,
            viewsDir: app.get('views'),
            env: {
                NODE_ENV: process.env.NODE_ENV || null,
                PORT: process.env.PORT || null,
                RAILWAY_ENVIRONMENT: process.env.RAILWAY_ENVIRONMENT || null,
                RAILWAY_SERVICE_NAME: process.env.RAILWAY_SERVICE_NAME || null,
                RAILWAY_PROJECT_ID: process.env.RAILWAY_PROJECT_ID || null,
            }
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// (Removido) Rota de debug de Excel local — o projeto não usa mais EXCEL_PATH

// Diagnóstico de usuários e persistência (admin-only)
app.get('/debug/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await userRepository.findAllAsync();
        const roleCounts = users.reduce((acc, u) => {
            const r = (u.role || '').toLowerCase();
            acc[r] = (acc[r] || 0) + 1;
            return acc;
        }, {});
        res.json({
            status: 'ok',
            env: {
                NODE_ENV: process.env.NODE_ENV || null,
                DATA_DIR: process.env.DATA_DIR || null
            },
            usersCount: users.length,
            roleCounts,
            users: users.map(u => ({
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                allowedCountries: u.allowedCountries,
                isActive: u.isActive
            }))
        });
    } catch (e) {
        console.error('Erro em GET /debug/users', e);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// (Removido) Debug de arquivo local de usuários — o sistema usa apenas banco de dados

// (Removido) Diagnóstico de Google Drive/Excel — sistema usa apenas banco

// Endpoint administrativo seguro para migração CA→Marcelo diretamente pelo HTTP
// Uso:
// - Dry-run:  GET /admin/migrate/assign-marcelo-ca?token=YOUR_TOKEN
// - Aplicar:  GET /admin/migrate/assign-marcelo-ca?token=YOUR_TOKEN&apply=1
// Observações:
// - Protegido por token em ENV: ADMIN_MIGRATE_TOKEN
// - Requer acesso ao Postgres (DATABASE_URL válido no ambiente)
// - Atualiza registros country=CA em suppliers_json
app.get('/admin/migrate/assign-marcelo-ca', async (req, res) => {
    try {
        const token = req.query.token || req.headers['x-admin-token'];
        const expected = process.env.ADMIN_MIGRATE_TOKEN;
        if (!expected) {
            return res.status(400).json({ error: 'ADMIN_MIGRATE_TOKEN não configurado no ambiente.' });
        }
        if (!token || token !== expected) {
            return res.status(401).json({ error: 'Token inválido ou ausente.' });
        }

        if (!isDbEnabledForWrites()) {
            return res.status(400).json({ error: 'Banco de dados não está habilitado para escrita neste ambiente.' });
        }

        const apply = req.query.apply === '1' || req.query.apply === 'true';

        // Obter usuário Marcelo
        const { rows: userRows } = await pool.query(
            `SELECT id, username FROM users WHERE lower(username) = 'marcelo' ORDER BY id LIMIT 1`
        );
        if (!userRows || userRows.length === 0) {
            return res.status(404).json({ error: 'Usuário "marcelo" não encontrado na tabela users.' });
        }
        const marceloId = userRows[0].id;
        const marceloName = 'Marcelo';

        // Dry-run: contar registros de CA e estimar atualizações
        const { rows: countRows } = await pool.query(
            `SELECT COUNT(*)::int AS total_ca,
                    SUM(CASE WHEN COALESCE(created_by_user_id, 0) = $1 THEN 1 ELSE 0 END)::int AS ca_com_marcelo
             FROM suppliers_json
             WHERE country = 'CA'`,
            [marceloId]
        );
        const info = countRows?.[0] || { total_ca: 0, ca_com_marcelo: 0 };

        if (!apply) {
            return res.json({
                mode: 'dry-run',
                summary: 'Registros CA e quantos já estão com Marcelo.',
                total_ca: info.total_ca,
                ca_com_marcelo: info.ca_com_marcelo,
                would_update: Math.max(0, info.total_ca - info.ca_com_marcelo)
            });
        }

        // Aplicar migração: atualizar created_by_* e JSON (Responsable, Created_By_*, Country)
        const updateSql = `
            WITH marcelo AS (
                SELECT $1::bigint AS id, $2::text AS name
            )
            UPDATE suppliers_json AS s
            SET
              created_by_user_id   = m.id,
              created_by_user_name = m.name,
              data = jsonb_set(
                       jsonb_set(
                         jsonb_set(
                           jsonb_set(
                             s.data,
                             '{Responsable}',
                             to_jsonb(
                               CASE
                                 WHEN position('marcelo' in lower(coalesce(s.data->>'Responsable',''))) > 0
                                   THEN s.data->>'Responsable'
                                 ELSE trim(both ' | ' from coalesce(s.data->>'Responsable','') || ' | Marcelo')
                               END
                             ),
                             true
                           ),
                           '{Created_By_User_ID}',
                           to_jsonb(m.id::text),
                           true
                         ),
                         '{Created_By_User_Name}',
                         to_jsonb(m.name),
                         true
                       ),
                       '{Country}',
                       to_jsonb('CA'),
                       true
                     ),
              updated_at = CURRENT_TIMESTAMP
            FROM marcelo AS m
            WHERE s.country = 'CA';
        `;

        const result = await pool.query(updateSql, [marceloId, marceloName]);

        // Pós-verificação
        const { rows: postRows } = await pool.query(
            `SELECT COUNT(*)::int AS total_ca,
                    SUM(CASE WHEN COALESCE(created_by_user_id, 0) = $1 THEN 1 ELSE 0 END)::int AS ca_com_marcelo
             FROM suppliers_json
             WHERE country = 'CA'`,
            [marceloId]
        );
        const after = postRows?.[0] || { total_ca: 0, ca_com_marcelo: 0 };

        return res.json({
            mode: 'apply',
            updated_rows: result.rowCount || 0,
            total_ca_after: after.total_ca,
            ca_com_marcelo_after: after.ca_com_marcelo
        });
    } catch (e) {
        console.error('Erro na migração HTTP CA→Marcelo:', e);
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Middleware simples para validar token admin via ENV
function requireAdminApiToken(req, res, next) {
    const token = req.query.token || req.headers['x-admin-token'];
    const expected = process.env.ADMIN_MIGRATE_TOKEN;
    if (!expected) {
        return res.status(400).json({ error: 'ADMIN_MIGRATE_TOKEN não configurado no ambiente.' });
    }
    if (!token || token !== expected) {
        return res.status(401).json({ error: 'Token inválido ou ausente.' });
    }
    next();
}

// Migração geral: atribuir Marcelo em qualquer registro que o mencione (Responsable/Manager/Buyer/email)
// Uso:
// - Dry-run:  POST /admin/migrate/assign-marcelo?apply=0&force=0
// - Aplicar:  POST /admin/migrate/assign-marcelo?apply=1&force=0
// - Forçar sobrescrever Created_By_*: adicionar &force=1
app.post('/admin/migrate/assign-marcelo', requireAdminApiToken, async (req, res) => {
    try {
        if (!isDbEnabledForWrites()) {
            return res.status(400).json({ error: 'Banco de dados não está habilitado para escrita neste ambiente.' });
        }

        const apply = String(req.query.apply || req.body?.apply || '0') === '1' || String(req.query.apply || req.body?.apply || '').toLowerCase() === 'true';
        const force = String(req.query.force || req.body?.force || '0') === '1' || String(req.query.force || req.body?.force || '').toLowerCase() === 'true';

        const marceloUser = await userRepository.findByEmailAsync('marcelogalvis@mylokok.com');
        if (!marceloUser) {
            return res.status(404).json({ error: 'Usuário Marcelo não encontrado no banco de dados.' });
        }

        // Helpers locais
        const ensureResponsable = (rec, personName) => {
            const managerRaw = ((rec.Responsable || rec.Manager || rec.Buyer || '') + '').trim();
            const responsaveis = managerRaw ? managerRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
            const hasPerson = responsaveis.some(r => String(r || '').trim().toLowerCase() === String(personName || '').trim().toLowerCase());
            if (!hasPerson) responsaveis.push(personName);
            rec.Responsable = responsaveis.join(', ');
        };
        const setCreatedBy = (rec, user, forceSet) => {
            const idOk = rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === String(user.id).trim();
            const nameOk = rec.Created_By_User_Name && String(rec.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
            const emailOk = rec.Created_By_User_Email && String(rec.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
            if (forceSet || !(idOk || nameOk || emailOk)) {
                rec.Created_By_User_ID = user.id;
                rec.Created_By_User_Name = user.name || (String(user.email).split('@')[0]);
                rec.Created_By_User_Email = user.email;
                if (!rec.Created_At) rec.Created_At = new Date().toISOString();
                return true;
            }
            return false;
        };

        const { rows } = await pool.query(`SELECT id, data FROM suppliers_json`);
        let examined = 0;
        let updated = 0;
        let updatedResponsable = 0;
        let updatedCreated = 0;

        for (const row of rows) {
            examined++;
            const rec = { ...(row.data || {}) };
            const mentionSource = extractManagerLikeValue(rec);
            const mentionsMarcelo = isUserMentionedIn(mentionSource, marceloUser);
            if (!mentionsMarcelo) continue;

            const before = JSON.stringify(rec);
            const prevResp = rec.Responsable || rec.Manager || rec.Buyer || '';
            ensureResponsable(rec, marceloUser.name);
            if ((rec.Responsable || '') !== (prevResp || '')) {
                updatedResponsable++;
            }
            const changedCreated = setCreatedBy(rec, marceloUser, force);
            if (changedCreated) updatedCreated++;
            const after = JSON.stringify(rec);
            const changed = before !== after;

            if (apply && changed) {
                updated++;
                await pool.query(
                    `UPDATE suppliers_json
                     SET data = $2, created_by_user_id = $3, created_by_user_name = $4, updated_at = NOW()
                     WHERE id = $1`,
                    [row.id, rec, marceloUser.id, marceloUser.name]
                );
            }
        }

        return res.json({
            mode: apply ? 'apply' : 'dry-run',
            examined,
            updated,
            updatedResponsable,
            updatedCreated
        });
    } catch (e) {
        console.error('Erro na migração HTTP geral → Marcelo:', e);
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Correção administrativa: substituir datas indevidas (ex.: "2025-12-04") por um nome (ex.: "Marcelo")
// nos campos Manager/Buyer/Responsable, opcionalmente limitado por país.
// Uso:
// - Dry-run:  GET /admin/fix/manager-date?token=YOUR_TOKEN&date=2025-12-04&name=Marcelo&country=CA
// - Aplicar:  GET /admin/fix/manager-date?token=YOUR_TOKEN&date=2025-12-04&name=Marcelo&country=CA&apply=1
app.get('/admin/fix/manager-date', requireAdminApiToken, async (req, res) => {
    try {
        if (!isDbEnabledForWrites()) {
            return res.status(400).json({ error: 'Banco de dados não está habilitado para escrita neste ambiente.' });
        }

        const dateStr = String(req.query.date || '2025-12-04');
        const name = String(req.query.name || 'Marcelo');
        const country = (req.query.country ? String(req.query.country).toUpperCase() : '').trim();
        const apply = String(req.query.apply || '').toLowerCase();
        const doApply = apply === '1' || apply === 'true';

        const like = `%${dateStr}%`;
        let sql = `
            SELECT id, country, data
            FROM suppliers_json
            WHERE (
              (data->>'Manager') ILIKE $1 OR
              (data->>'Buyer') ILIKE $1 OR
              (data->>'Responsable') ILIKE $1
            )`;
        const params = [like];
        if (country) { sql += ` AND (country = $2)`; params.push(country); }

        const { rows } = await pool.query(sql, params);

        // Função util para identificar formatos comuns da mesma data
        function isDateLike(value) {
            if (!value) return false;
            const s = String(value).trim();
            if (!s) return false;
            if (s === dateStr || s.includes(dateStr)) return true;
            const variants = ['04/12/2025','12/04/2025','Dec 04 2025','04 Dec 2025','2025/12/04','2025-12-04'];
            return variants.some(v => s.includes(v));
        }

        if (!doApply) {
            return res.json({
                mode: 'dry-run',
                checked: rows.length,
                to_fix_ids: rows.map(r => r.id),
                country: country || null,
                date: dateStr,
                name
            });
        }

        let updated = 0;
        const affected = [];
        for (const row of rows) {
            const data = row.data;
            const records = Array.isArray(data) ? data : [data];
            let changed = false;
            const fixed = records.map(rec => {
                const r = { ...rec };
                if (isDateLike(r.Manager)) { r.Manager = name; changed = true; }
                if (isDateLike(r.Buyer)) { r.Buyer = name; changed = true; }
                if (isDateLike(r.Responsable)) { r.Responsable = name; changed = true; }
                return r;
            });
            if (!changed) continue;
            const payload = Array.isArray(data) ? fixed : fixed[0];
            await pool.query(`UPDATE suppliers_json SET data = $1, updated_at = NOW() WHERE id = $2`, [payload, row.id]);
            updated++;
            affected.push(row.id);
        }

        const { rows: remainingRows } = await pool.query(sql, params);
        return res.json({
            mode: 'apply',
            checked: rows.length,
            updated,
            affected,
            remaining: remainingRows.map(r => r.id),
            country: country || null,
            date: dateStr,
            name
        });
    } catch (e) {
        console.error('Erro em /admin/fix/manager-date:', e);
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Alias em GET para facilitar execução via navegador/curl simples
// Uso:
// - Dry-run:  GET /admin/migrate/assign-marcelo?token=...&apply=0&force=0
// - Aplicar:  GET /admin/migrate/assign-marcelo?token=...&apply=1&force=1
app.get('/admin/migrate/assign-marcelo', requireAdminApiToken, async (req, res) => {
    try {
        if (!isDbEnabledForWrites()) {
            return res.status(400).json({ error: 'Banco de dados não está habilitado para escrita neste ambiente.' });
        }

        const apply = String(req.query.apply || '0') === '1' || String(req.query.apply || '').toLowerCase() === 'true';
        const force = String(req.query.force || '0') === '1' || String(req.query.force || '').toLowerCase() === 'true';

        const marceloUser = await userRepository.findByEmailAsync('marcelogalvis@mylokok.com');
        if (!marceloUser) {
            return res.status(404).json({ error: 'Usuário Marcelo não encontrado no banco de dados.' });
        }

        const ensureResponsable = (rec, personName) => {
            const managerRaw = ((rec.Responsable || rec.Manager || rec.Buyer || '') + '').trim();
            const responsaveis = managerRaw ? managerRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
            const hasPerson = responsaveis.some(r => String(r || '').trim().toLowerCase() === String(personName || '').trim().toLowerCase());
            if (!hasPerson) responsaveis.push(personName);
            rec.Responsable = responsaveis.join(', ');
        };
        const setCreatedBy = (rec, user, forceSet) => {
            const idOk = rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === String(user.id).trim();
            const nameOk = rec.Created_By_User_Name && String(rec.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
            const emailOk = rec.Created_By_User_Email && String(rec.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
            if (forceSet || !(idOk || nameOk || emailOk)) {
                rec.Created_By_User_ID = user.id;
                rec.Created_By_User_Name = user.name || (String(user.email).split('@')[0]);
                rec.Created_By_User_Email = user.email;
                if (!rec.Created_At) rec.Created_At = new Date().toISOString();
                return true;
            }
            return false;
        };

        const { rows } = await pool.query(`SELECT id, data FROM suppliers_json`);
        let examined = 0;
        let updated = 0;
        let updatedResponsable = 0;
        let updatedCreated = 0;

        for (const row of rows) {
            examined++;
            const rec = { ...(row.data || {}) };
            const mentionSource = extractManagerLikeValue(rec);
            const mentionsMarcelo = isUserMentionedIn(mentionSource, marceloUser);
            if (!mentionsMarcelo) continue;

            const before = JSON.stringify(rec);
            const prevResp = rec.Responsable || rec.Manager || rec.Buyer || '';
            ensureResponsable(rec, marceloUser.name);
            if ((rec.Responsable || '') !== (prevResp || '')) {
                updatedResponsable++;
            }
            const changedCreated = setCreatedBy(rec, marceloUser, force);
            if (changedCreated) updatedCreated++;
            const after = JSON.stringify(rec);
            const changed = before !== after;

            if (apply && changed) {
                updated++;
                await pool.query(
                    `UPDATE suppliers_json
                     SET data = $2, created_by_user_id = $3, created_by_user_name = $4, updated_at = NOW()
                     WHERE id = $1`,
                    [row.id, rec, marceloUser.id, marceloUser.name]
                );
            }
        }

        return res.json({
            mode: apply ? 'apply' : 'dry-run',
            examined,
            updated,
            updatedResponsable,
            updatedCreated
        });
    } catch (e) {
        console.error('Erro na migração HTTP geral (GET) → Marcelo:', e);
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Reset de senha de um usuário via token admin
// Uso: POST /admin/users/reset-password?token=...  body: { email, password }
app.post('/admin/users/reset-password', requireAdminApiToken, async (req, res) => {
    try {
        const { email, password } = req.body || {};
        if (!email || !password) {
            return res.status(400).json({ success: false, message: 'email e password são obrigatórios' });
        }
        let user = await userRepository.findByEmailAsync(email);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
        }
        await userRepository.updatePasswordByEmailAsync(email, password);
        return res.json({ success: true, message: 'Senha atualizada', user: { id: user.id, email: user.email } });
    } catch (e) {
        return res.status(500).json({ success: false, error: e?.message || String(e) });
    }
});

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
// Auditoria
const audit = require('./audit');

// Removida integração com Google Drive — fonte única: banco de dados

// Logs detalhados para produção
console.log('🚀 [PRODUCTION DEBUG] Iniciando servidor LOKOK2...');
console.log('🌍 [PRODUCTION DEBUG] NODE_ENV:', process.env.NODE_ENV);
console.log('📁 [PRODUCTION DEBUG] __dirname:', __dirname);
console.log('📁 [PRODUCTION DEBUG] process.cwd():', process.cwd());

// Instância do repositório de usuários - sempre banco de dados
const userRepository = new DbUserRepository();
console.log('👥 [PRODUCTION DEBUG] Fonte de usuários: database');
// Aplicar fixes de senha via ENV assim que o repositório estiver disponível
applyEnvPasswordFixes();

// Endpoints internos protegidos por token para facilitar diagnóstico sem Shell
const INTERNAL_BOOTSTRAP_TOKEN = process.env.INTERNAL_BOOTSTRAP_TOKEN || process.env.BOOTSTRAP_TOKEN || null;
function hasBootstrapToken(req) {
    const token = String((req.headers['x-bootstrap-token'] || req.query.token || (req.body && req.body.token) || '')).trim();
    return !!INTERNAL_BOOTSTRAP_TOKEN && token === INTERNAL_BOOTSTRAP_TOKEN;
}

// Cria/atualiza usuários simples de teste com senha padrão
app.post('/internal/bootstrap-test-users', async (req, res) => {
    if (!hasBootstrapToken(req)) {
        return res.status(403).json({ success: false, message: 'Token inválido ou não configurado' });
    }
    try {
        const password = 'test12345';
        const users = [
            { email: 'qa@mylokok.com', name: 'QA User', role: 'operator', allowedCountries: ['US'] },
            { email: 'test@mylokok.com', name: 'Test User', role: 'operator', allowedCountries: ['US'] },
            { email: 'manager@mylokok.com', name: 'Manager User', role: 'manager', allowedCountries: ['US','CA','MX'] },
        ];
        const results = [];
        for (const u of users) {
            try {
                const created = await userRepository.createAsync({
                    email: u.email,
                    password,
                    role: u.role,
                    name: u.name,
                    allowedCountries: u.allowedCountries
                });
                results.push({ ok: true, id: created.id, email: created.email, role: created.role });
            } catch (e) {
                results.push({ ok: false, email: u.email, error: e?.message || String(e) });
            }
        }
        return res.json({ success: true, results });
    } catch (e) {
        return res.status(500).json({ success: false, error: e?.message || String(e) });
    }
});

// Verifica senha de um usuário por email ou username
app.post('/internal/verify-login', async (req, res) => {
    if (!hasBootstrapToken(req)) {
        return res.status(403).json({ success: false, message: 'Token inválido ou não configurado' });
    }
    try {
        const { identifier, password } = req.body || {};
        if (!identifier || !password) {
            return res.status(400).json({ success: false, message: 'identifier e password são obrigatórios' });
        }
        const user = await userRepository.findByEmailOrUsernameAsync(identifier);
        if (!user) {
            return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
        }
        const match = await User.comparePassword(password, user.password);
        return res.json({ success: true, user: { id: user.id, email: user.email, role: user.role }, passwordMatch: !!match });
    } catch (e) {
        return res.status(500).json({ success: false, error: e?.message || String(e) });
    }
});

// Inspeciona colunas, índices e constraints da tabela users
app.get('/internal/inspect-users-table', async (req, res) => {
    if (!hasBootstrapToken(req)) {
        return res.status(403).json({ success: false, message: 'Token inválido ou não configurado' });
    }
    try {
        const columns = await pool.query(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_schema='public' AND table_name='users'
          ORDER BY ordinal_position;
        `);

        const constraints = await pool.query(`
          SELECT c.conname AS name, c.contype AS type, pg_get_constraintdef(c.oid) AS definition
          FROM pg_constraint c
          JOIN pg_class t ON c.conrelid = t.oid
          JOIN pg_namespace n ON t.relnamespace = n.oid
          WHERE n.nspname = 'public' AND t.relname = 'users'
          ORDER BY c.conname;
        `);

        const indexes = await pool.query(`
          SELECT indexname, indexdef
          FROM pg_indexes
          WHERE schemaname='public' AND tablename='users'
          ORDER BY indexname;
        `);

        const hasEmailUnique = constraints.rows.some(r => /UNIQUE \(email\)/i.test(r.definition)) ||
          indexes.rows.some(r => /UNIQUE INDEX.*\(email\)/i.test(r.indexdef));

        return res.json({
            success: true,
            columns: columns.rows,
            constraints: constraints.rows,
            indexes: indexes.rows,
            checks: { hasEmailUnique }
        });
    } catch (e) {
        return res.status(500).json({ success: false, error: e?.message || String(e) });
    }
});

// Configuração do multer para upload de arquivos
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        // Aceitar apenas arquivos Excel
        if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
            file.mimetype === 'application/vnd.ms-excel' ||
            file.originalname.match(/\.(xlsx|xls)$/)) {
            cb(null, true);
        } else {
            cb(new Error('Only Excel files are allowed!'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware de autenticação
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Helpers para normalizar papeis (PT/EN)
function normalizeRole(r) {
    const k = ((r || '') + '').toLowerCase();
    const map = {
        'admin': 'admin',
        'gerente': 'manager',
        'manager': 'manager',
        'operador': 'operator',
        'operator': 'operator'
    };
    return map[k] || k;
}

// Helper global para normalizar textos (acentos, caixa e espaços)
function normalize(s) {
    return ((s || '') + '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Snapshot da configuração de banco atual
function getDbInfo() {
    try {
        const urlStr = process.env.DATABASE_URL || '';
        const u = new URL(urlStr);
        const useDb = String(process.env.USE_DB || '').toLowerCase();
        const useDbUsers = String(process.env.USE_DB_USERS || '').toLowerCase();
        return {
            host: u.hostname || null,
            port: u.port ? Number(u.port) : null,
            database: (u.pathname || '').replace(/^\//, '') || null,
            useDb: useDb === 'true' || useDb === '1',
            useDbUsers: useDbUsers === 'true' || useDbUsers === '1'
        };
    } catch (_) {
        const useDb = String(process.env.USE_DB || '').toLowerCase();
        const useDbUsers = String(process.env.USE_DB_USERS || '').toLowerCase();
        return {
            host: null,
            port: null,
            database: null,
            useDb: useDb === 'true' || useDb === '1',
            useDbUsers: useDbUsers === 'true' || useDbUsers === '1'
        };
    }
}

// Helper global para obter um campo de forma robusta (ignora acentos, caixa, espaços e pontuação)
function getField(record, keys) {
    try {
        if (!record || typeof record !== 'object') return '';
        const normalizeKey = (s) => ((s || '') + '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
        const wanted = new Set((Array.isArray(keys) ? keys : []).map(k => normalizeKey(k)));
        for (const k of Object.keys(record)) {
            const nk = normalizeKey(k);
            if (wanted.has(nk)) {
                const v = record[k];
                if (v !== undefined && v !== null && ((String(v)).trim().length > 0)) {
                    return v;
                }
            }
        }
        // fallback: tentativa direta usando as chaves fornecidas
        for (const k of (Array.isArray(keys) ? keys : [])) {
            const v = record[k];
            if (v !== undefined && v !== null && ((String(v)).trim().length > 0)) {
                return v;
            }
        }
        return '';
    } catch (_) {
        return '';
    }
}

// Middleware de autorização por role
function requireRole(roles) {
    return (req, res, next) => {
        const userRole = normalizeRole(req.session.user && req.session.user.role);
        const accepted = Array.isArray(roles) ? roles.map(normalizeRole) : [];
        if (req.session.user && accepted.includes(userRole)) {
            next();
        } else {
            res.status(403).send('Access denied');
        }
    };
}

// Middleware para verificar se é administrador
function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Access denied - Administrators only');
    }
}

// Middleware para verificar se é gerente ou admin
function requireManagerOrAdmin(req, res, next) {
    const role = normalizeRole(req.session.user && req.session.user.role);
    if (req.session.user && ['admin', 'manager'].includes(role)) {
        next();
    } else {
        res.status(403).send('Access denied');
    }
}

// Extrai um valor de responsabilidade (Responsable/Manager/Buyer e variações)
function extractManagerLikeValue(rec) {
    if (!rec || typeof rec !== 'object') return '';
    const obj = rec.distributor && typeof rec.distributor === 'object' ? rec.distributor : rec;
    // Tentar via getField com um conjunto expandido de chaves conhecidas
    const primary = getField(obj, [
        'Responsable', 'Manager', 'Buyer',
        'Responsable Buyer', 'Responsible Buyer', 'Buyer Responsable', 'Buyer Responsible',
        'Assigned', 'Assigned To', 'Assigned_To', 'AssignedTo',
        'Purchase Manager', 'Purchasing Manager', 'Purchasing Buyer', 'Buyer Manager'
    ]);
    if ((primary || '').trim().length > 0) return primary;
    // Fallback: varrer chaves e procurar tokens de responsabilidade
    const normalizeKey = (s) => String(s || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '');
    const tokens = ['responsable','responsible','manager','buyer','assigned','purchase','purchasing'];
    const keys = Object.keys(obj || {});
    for (const k of keys) {
        const nk = normalizeKey(k);
        if (tokens.some(t => nk.includes(t))) {
            const val = obj[k];
            if ((val || '').toString().trim().length > 0) return val;
        }
    }
    // Fallback final: agregar múltiplos campos relacionados para permitir match por menção
    try {
        const aggFields = [
            'Responsable','Manager','Buyer',
            'Responsable Buyer','Responsible Buyer','Buyer Responsable','Buyer Responsible',
            'Assigned','Assigned To','Assigned_To','AssignedTo',
            'Purchase Manager','Purchasing Manager','Purchasing Buyer','Buyer Manager',
            'Created_By_User_Name','Created_By_User_Email'
        ];
        const parts = [];
        for (const f of aggFields) {
            const v = getField(obj, [f]);
            if ((v || '').toString().trim().length > 0) parts.push(String(v));
        }
        const combined = parts.join(' | ');
        if ((combined || '').trim().length > 0) return combined;
    } catch (_) {}
    return '';
}

// Verifica se o usuário é mencionado em um valor de responsabilidade (por email, nome completo ou tokens do nome)
function isUserMentionedIn(value, user) {
    const v = String(value || '').toLowerCase();
    if (!v) return false;
    const email = String(user?.email || '').toLowerCase();
    const fullName = String(user?.name || '').toLowerCase();
    const tokens = fullName.split(/\s+/).filter(t => t && t.length >= 3);
    if (email && v.includes(email)) return true;
    if (fullName && v.includes(fullName)) return true;
    return tokens.some(t => v.includes(t));
}

// Helpers de armazenamento local de distribuidores (pendências, aprovações, tarefas de operador)
// Permitir diretório de dados configurável para persistência (ex.: Railway Volume)
const DATA_DIR = (function resolveDataDir() {
    if (process.env.DATA_DIR) return path.resolve(process.env.DATA_DIR);
    try {
        if (fs.existsSync('/data')) return '/data';
    } catch (_) {}
    return path.join(__dirname, 'data');
})();
const SUPPLIERS_STORE_PATH = path.join(DATA_DIR, 'suppliers.json');
function ensureSuppliersStore() {
    try {
        const dir = path.dirname(SUPPLIERS_STORE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        if (!fs.existsSync(SUPPLIERS_STORE_PATH)) {
            fs.writeFileSync(SUPPLIERS_STORE_PATH, JSON.stringify([] , null, 2), 'utf8');
        }
    } catch (e) {
        console.warn('Aviso: falha ao garantir store local:', e?.message);
    }
}
function readSuppliersStore() {
    try {
        ensureSuppliersStore();
        const raw = fs.readFileSync(SUPPLIERS_STORE_PATH, 'utf8');
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch (e) {
        console.warn('Aviso: falha ao ler store local:', e?.message);
        return [];
    }
}
function writeSuppliersStore(arr) {
    try {
        ensureSuppliersStore();
        fs.writeFileSync(SUPPLIERS_STORE_PATH, JSON.stringify(arr || [], null, 2), 'utf8');
        return true;
    } catch (e) {
        console.warn('Aviso: falha ao escrever store local:', e?.message);
        return false;
    }
}

// Utilitários para garantir abas de país no Excel
function getSheetNameForCountry(country) {
    const c = String(country || '').toUpperCase();
    if (c === 'CA') return 'Wholesale CANADA';
    if (c === 'MX') return 'Wholesale MEXICO';
    // US: usar a aba principal "Wholesale LOKOK"
    return 'Wholesale LOKOK';
}

// Aliases por país para filtragem robusta quando a planilha usa nomes completos
function getCountryAliases(code) {
    const c = String(code || '').toUpperCase();
    if (c === 'US') return ['US', 'USA', 'UNITED STATES'];
    if (c === 'CA') return ['CA', 'CAN', 'CANADA'];
    if (c === 'MX') return ['MX', 'MEX', 'MEXICO'];
    if (c === 'CN') return ['CN', 'CHINA'];
    return [c];
}

// Normaliza códigos de país para US/CA/MX e remove duplicatas
function normalizeCountryCode(code) {
    const c = String(code || '').toUpperCase();
    if (['US', 'USA', 'UNITED STATES'].includes(c)) return 'US';
    if (['CA', 'CAN', 'CANADA'].includes(c)) return 'CA';
    if (['MX', 'MEX', 'MEXICO'].includes(c)) return 'MX';
    // Não aceitar CN como Canadá; manter fora por padrão
    return null;
}

function normalizeAllowedCountries(list) {
    const arr = Array.isArray(list) ? list : [];
    const normalized = arr.map(normalizeCountryCode).filter(Boolean);
    // Remover CN explicitamente, se presente
    const withoutCN = normalized.filter(c => c !== 'CN');
    return Array.from(new Set(withoutCN));
}

function inferHeadersFromWorksheet(ws) {
    try {
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
        const headerRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : [];
        if (Array.isArray(headerRow) && headerRow.length > 0) return headerRow;
    } catch (_) {}
    // Fallback para conjunto de campos esperado
    return [
        'Name','Website','CATEGORÍA','Type','Account Request Status','DATE','Responsable',
        'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)',
        'Description/Notes','Contact Name','Contact Phone','E-Mail','Address','User','PASSWORD',
        'LLAMAR','PRIO (1 - TOP, 5 - baixo)','Comments','Country','Created_By_User_ID','Created_By_User_Name','Created_At'
    ];
}

// Normaliza chaves de colunas vindas da planilha para as esperadas pela UI
function normalizeRecordKeys(row) {
    if (!row || typeof row !== 'object') return row;
    const map = new Map([
        ['Company Name', 'Name'],
        ['Category', 'CATEGORÍA'],
        ['TYPE', 'Type'],
        ['type', 'Type'],
        ['Type ', 'Type'],
        ['Registered User', 'User'],
        ['Registered PASSWORD', 'PASSWORD'],
        ['STATUS', 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)'],
        ['PRIO (1 - TOP, 5 - baixo)', 'PRIO (1 - TOP, 5 - bajo)'],
        ['PRIO (1 - TOP, 5 - BAJO)', 'PRIO (1 - TOP, 5 - bajo)'],
    ]);
    const out = { ...row };
    for (const [src, dest] of map.entries()) {
        if (out[dest] == null && out[src] != null) {
            out[dest] = out[src];
        }
    }
    return out;
}

// Enriquecimento: tudo que estiver com responsável “Nacho” conta como criado por Ignacio
async function enrichCreatedByForNacho(records) {
    try {
        if (!Array.isArray(records) || records.length === 0) return;
        const targetEmail = 'ignaciocortez@mylokok.com';
        const users = await userRepository.findAllAsync();
        const nachoUser = users.find(u => String(u.email || '').toLowerCase() === targetEmail)
            || users.find(u => String(u.name || '').toLowerCase() === 'nacho');
        if (!nachoUser) return;

        for (const r of records) {
            const rec = r && r.distributor ? r.distributor : r;
            if (!rec || typeof rec !== 'object') continue;
            const responsableLc = String(rec.Responsable || '').trim().toLowerCase();
            const managerLc = String(rec.Manager || '').trim().toLowerCase();
            const buyerLc = String(rec.Buyer || '').trim().toLowerCase();
            const createdNameLc = String(rec.Created_By_User_Name || '').trim().toLowerCase();
            const createdEmailLc = String(rec.Created_By_User_Email || '').trim().toLowerCase();

            const isNacho = responsableLc.includes('nacho')
                || managerLc.includes('nacho')
                || buyerLc.includes('nacho')
                || createdNameLc.includes('nacho')
                || (createdEmailLc && createdEmailLc === String(targetEmail).toLowerCase());

            if (isNacho) {
                // Garantir que contabiliza e aparece como criado por Ignacio
                rec.Created_By_User_ID = nachoUser.id;
                rec.Created_By_User_Name = nachoUser.name;
                rec.Created_By_User_Email = nachoUser.email;
            }
        }
    } catch (_) {
        // Não bloquear fluxo em caso de erro de enriquecimento
    }
}

function ensureCountrySheets(workbook) {
    if (!workbook || !workbook.SheetNames) return { changed: false };
    const sheetNames = workbook.SheetNames;
    const hasUS = sheetNames.includes('Wholesale LOKOK');
    const hasCA = sheetNames.includes('Wholesale CANADA');
    const hasMX = sheetNames.includes('Wholesale MEXICO');
    let changed = false;

    // Base de cabeçalhos: tenta da aba US ou da primeira aba
    const baseWs = hasUS ? workbook.Sheets['Wholesale LOKOK'] : workbook.Sheets[sheetNames[0]];
    const headers = inferHeadersFromWorksheet(baseWs);
    const emptySheetAoA = [headers];
    const emptyWS_CA = XLSX.utils.aoa_to_sheet(emptySheetAoA);
    const emptyWS_MX = XLSX.utils.aoa_to_sheet(emptySheetAoA);

    if (!hasCA) {
        workbook.Sheets['Wholesale CANADA'] = emptyWS_CA;
        workbook.SheetNames.push('Wholesale CANADA');
        changed = true;
        console.log('📄 Criada aba vazia: Wholesale CANADA');
    }
    if (!hasMX) {
        workbook.Sheets['Wholesale MEXICO'] = emptyWS_MX;
        workbook.SheetNames.push('Wholesale MEXICO');
        changed = true;
        console.log('📄 Criada aba vazia: Wholesale MEXICO');
    }

    return { changed };
}

function findSheetNameForCountryCaseInsensitive(sheetNames, country) {
    const normalize = (s) => String(s || '').trim().toUpperCase();
    const preferred = getSheetNameForCountry(country);
    const preferredNorm = normalize(preferred);
    const c = String(country || '').toUpperCase();
    const namesMap = new Map((sheetNames || []).map(n => [normalize(n), n]));

    console.log('[TELEMETRY] resolveSheet:start', {
        country: c,
        preferred,
        candidatesCount: (sheetNames || []).length,
        candidates: sheetNames || [],
    });

    if (namesMap.has(preferredNorm)) {
        const result = namesMap.get(preferredNorm);
        console.log('[TELEMETRY] resolveSheet:exact', { result });
        return result;
    }

    const token = (c === 'MX') ? 'MEXICO' : (c === 'CA') ? 'CANADA' : 'LOKOK';
    const tokenMatch = (sheetNames || []).find(n => normalize(n).includes(token));
    if (tokenMatch) {
        console.log('[TELEMETRY] resolveSheet:token', { token, result: tokenMatch });
        return tokenMatch;
    }

    const variants = [
        preferred,
        preferred.toLowerCase(),
        preferred.toUpperCase(),
        (c === 'MX') ? 'Wholesale Mexico' : null,
        (c === 'CA') ? 'Wholesale Canada' : null,
        (c === 'US') ? 'Wholesale Lokok' : null,
    ].filter(Boolean);
    for (const v of variants) {
        const vNorm = normalize(v);
        if (namesMap.has(vNorm)) {
            const result = namesMap.get(vNorm);
            console.log('[TELEMETRY] resolveSheet:variant', { tried: v, result });
            return result;
        }
    }
    console.log('[TELEMETRY] resolveSheet:none', { country: c });
    return null;
}

// Fonte única de dados: banco de dados (JSONB)
async function readDbData(selectedCountry) {
    const selectedForSource = (String(selectedCountry || '').toUpperCase() === 'ALL') ? null : selectedCountry;
    if (!selectedForSource) {
        const rows = await getJsonSuppliers();
        return rows;
    }
    const aliases = getCountryAliases(selectedForSource);
    const rows = await getJsonSuppliers(Array.isArray(aliases) ? aliases : [selectedForSource]);
    return rows;
}

// Rotas
app.get('/', (req, res) => {
    if (req.session.user) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    console.log('[PRODUCTION DEBUG] Tentativa de login para (email/username):', email);
    console.log('[PRODUCTION DEBUG] IP do cliente:', req.ip);
    console.log('[PRODUCTION DEBUG] User-Agent:', req.get('User-Agent'));
    console.log('[PRODUCTION DEBUG] Password length:', password?.length);
    // Auditoria de tentativa
    try {
        audit.logAccess('login_attempt', email, req.ip, req.get('User-Agent'));
    } catch (_) {}
    
    let user = null;
    try {
        // Aceita email ou username (compatibilidade com bases legadas)
        if (typeof userRepository.findByEmailOrUsernameAsync === 'function') {
            user = await userRepository.findByEmailOrUsernameAsync(email);
        } else {
            user = await userRepository.findByEmailAsync(email);
        }
    } catch (e) {
        console.warn('[PRODUCTION DEBUG] Falha ao obter usuário para login:', e?.message || e);
    }
    console.log('[PRODUCTION DEBUG] Usuário encontrado:', user ? { id: user.id, email: user.email, role: user.role } : 'null');
    // Auditoria de lookup
    try {
        const dbInfo = getDbInfo();
        audit.logActivity('login_lookup', email, 'users', `found=${!!user}; db_host=${dbInfo.host}; db_port=${dbInfo.port}; db_name=${dbInfo.database}; useDb=${dbInfo.useDb}; useDbUsers=${dbInfo.useDbUsers}`, req.ip);
    } catch (_) {}
    
    if (user && User.comparePassword(password, user.password)) {
        console.log('[PRODUCTION DEBUG] Login bem-sucedido para:', email);
        console.log('[PRODUCTION DEBUG] Configurando sessão para usuário:', { id: user.id, email: user.email, role: user.role });
        req.session.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            // Normalize to uppercase to satisfy validation in /switch-country
            allowedCountries: Array.isArray(user.allowedCountries)
                ? user.allowedCountries.map(c => String(c).toUpperCase())
                : (user.role === 'admin' ? ['US', 'CA', 'MX'] : ['US'])
        };
        // Auditoria de sucesso
        try {
            audit.logAccess('login_success', email, req.ip, req.get('User-Agent'));
            const dbInfo = getDbInfo();
            audit.logActivity('login_success', email, 'session', `userId=${user.id}; role=${user.role}; allowed=${(req.session.user.allowedCountries||[]).join(',')}; db_host=${dbInfo.host}; db_port=${dbInfo.port}; db_name=${dbInfo.database}`, req.ip);
        } catch (_) {}
        // Definir país selecionado padrão na sessão
        if (!req.session.selectedCountry) {
            req.session.selectedCountry = (req.session.user.allowedCountries && req.session.user.allowedCountries[0]) ? req.session.user.allowedCountries[0] : 'US';
        }

        console.log('[PRODUCTION DEBUG] Sessão configurada (cookie-session). Respondendo 200 com redirecionamento via script...');
        res.status(200).send(`<!DOCTYPE html>
            <html><head>
                <meta http-equiv="refresh" content="0; url=/dashboard">
                <title>Login efetuado</title>
            </head>
            <body>
                <script>
                    // Redireciona imediatamente; assegura que o cookie seja enviado nesta resposta 200
                    window.location.replace('/dashboard');
                </script>
                <noscript>
                    Login efetuado. Continue para <a href="/dashboard">Dashboard</a>.
                </noscript>
            </body></html>`);
    } else {
        console.log('[PRODUCTION DEBUG] Login falhou para:', email);
        console.log('[PRODUCTION DEBUG] Usuário existe:', !!user);
        console.log('[PRODUCTION DEBUG] Senha válida:', user ? User.comparePassword(password, user.password) : false);
        // Auditoria de falha
        try {
            audit.logAccess('login_failure', email, req.ip, req.get('User-Agent'));
            const dbInfo = getDbInfo();
            audit.logActivity('login_failure', email, 'session', `userFound=${!!user}; db_host=${dbInfo.host}; db_port=${dbInfo.port}; db_name=${dbInfo.database}`, req.ip);
        } catch (_) {}
        res.render('login', { error: 'Invalid email or password' });
    }
});

app.get('/logout', (req, res) => {
    req.session = null;
    res.redirect('/login');
});

// Rota de debug para verificar sessão e cookies
app.get('/session-debug', (req, res) => {
    res.json({
        cookiesHeader: req.headers.cookie || null,
        sessionUser: req.session?.user || null,
        hasSession: !!req.session,
    });
});

// Rota admin para inspecionar auditoria de acessos e snapshot de configuração
app.get('/admin/audit/access', requireAuth, requireRole(['admin']), (req, res) => {
    try {
        const access = require('./audit').getAccessLogs(200);
        const dbInfo = getDbInfo();
        return res.json({
            config: dbInfo,
            access
        });
    } catch (e) {
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Ingestão de logs de UI (cadastro de usuários)
app.post('/admin/logs/ui', requireAuth, requireRole(['admin']), (req, res) => {
    try {
        const { event, ts, page, data } = req.body || {};
        const actor = req.session?.user?.email || 'unknown';
        const resource = page || 'users';
        const details = JSON.stringify({ event, ts, page, data });
        audit.logActivity('USER_UI_EVENT', actor, resource, details, req.ip);
        return res.json({ ok: true });
    } catch (e) {
        return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
});

// Debug: país atual na sessão e permissões do usuário
app.get('/debug/session-country', requireAuth, (req, res) => {
    try {
        const user = req.session.user || null;
        const allowed = normalizeAllowedCountries(user?.allowedCountries || []);
        const selected = req.session.selectedCountry || (allowed[0] || 'US');
        res.json({
            user: user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null,
            allowedCountries: allowed,
            selectedCountry: selected,
            rawSelectedCountry: req.session.selectedCountry || null
        });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Rota principal - Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
    console.log('[PRODUCTION DEBUG] Acessando dashboard para usuário:', req.session.user?.email);
    console.log('[PRODUCTION DEBUG] Role do usuário:', req.session.user?.role);
    console.log('[PRODUCTION DEBUG] Session ID:', req.sessionID);
    console.log('[PRODUCTION DEBUG] IP do cliente:', req.ip);
    
    try {
        console.log('[PRODUCTION DEBUG] Carregando dados para o dashboard...');
        console.log('[PRODUCTION DEBUG] Ambiente:', NODE_ENV);
        console.log('[PRODUCTION DEBUG] Google Drive Service disponível:', isGoogleDriveAvailable());
        
        const allowedCountries = normalizeAllowedCountries(req.session.user?.allowedCountries);
        const selectedCountry = req.session.selectedCountry || (allowedCountries[0] || 'US');
        const data = await readDbData(selectedCountry);
        // Mapear tudo que estiver como “Nacho” para Ignacio como criador
        await enrichCreatedByForNacho(data);
        console.log('[PRODUCTION DEBUG] Dados carregados:', data.length, 'registros');
    
    // Filtrar dados por usuário (apenas registros que eles criaram ou são responsáveis, exceto admin)
    let filteredData = data;
    if (req.session.user.role !== 'admin') {
        const userId = Number(req.session.user.id);
        const userNameLc = String(req.session.user.name || '').toLowerCase();
        const userEmailLc = String(req.session.user.email || '').toLowerCase();
        filteredData = data.filter(record => {
            const responsibleLc = String(record['Responsable'] || '').toLowerCase();
            const createdById = Number(record['Created_By_User_ID'] || 0);
            const createdByNameLc = String(record['Created_By_User_Name'] || '').toLowerCase();
            const createdByEmailLc = String(record['Created_By_User_Email'] || '').toLowerCase();
            return (createdById === userId)
                || responsibleLc.includes(userNameLc)
                || (createdByNameLc && createdByNameLc.includes(userNameLc))
                || (createdByEmailLc && createdByEmailLc === userEmailLc);
        });
    }

    // Ler parâmetros de ordenação/filtro do relatório mensal e filtro de datas dos recentes
    const { monthlySort, monthlyStart, monthlyEnd, recentStart, recentEnd } = req.query;

    // Preparar dados com data parseada para uso em Recent Records e estatísticas
    let processedData = filteredData.map(record => {
        let parsedDate = null;
        const dateValue = record['DATE'];
        try {
            if (dateValue !== undefined && dateValue !== null && String(dateValue).trim() !== '') {
                if (typeof dateValue === 'number' && dateValue > 0) {
                    parsedDate = new Date((dateValue - 25569) * 86400 * 1000);
                } else if (typeof dateValue === 'string') {
                    const d = new Date(dateValue);
                    if (!isNaN(d)) parsedDate = d;
                }
            }
        } catch (e) {
            // Ignorar erros de data individual
        }
        return { ...record, _parsedDate: parsedDate };
    });

    // Aplicar filtro por data nos registros recentes (opcional)
    let recentFilteredData = processedData;
    if (recentStart || recentEnd) {
        const startDate = recentStart ? new Date(recentStart) : null;
        const endDate = recentEnd ? new Date(recentEnd) : null;
        if (endDate) endDate.setHours(23, 59, 59, 999);
        recentFilteredData = processedData.filter(rec => {
            if (!rec._parsedDate) return false; // se filtrar por data, ignorar sem data
            if (startDate && rec._parsedDate < startDate) return false;
            if (endDate && rec._parsedDate > endDate) return false;
            return true;
        });
    }
    
    // Processar dados para estatísticas
    const categoryStats = {};
    const responsibleStats = {};
    const monthlyStats = {};
    const monthlyResponsibles = {}; // { 'YYYY-MM': { responsibleName: count } }
    
    filteredData.forEach(record => {
        // Estatísticas por categoria
        const category = record['CATEGORÍA'] || 'Não especificado';
        categoryStats[category] = (categoryStats[category] || 0) + 1;
        
        // Estatísticas por responsável
        const responsible = record['Responsable'] || 'Não especificado';
        responsibleStats[responsible] = (responsibleStats[responsible] || 0) + 1;
        
        // Estatísticas mensais (usando datas reais quando disponíveis)
        let date = null;
        const dateValue = record['DATE'];
        
        if (dateValue !== undefined && dateValue !== null && dateValue !== '' && String(dateValue).trim() !== '') {
            try {
                // Se for um número (serial do Excel), converter para data
                if (typeof dateValue === 'number' && dateValue > 0) {
                    // Converter número serial do Excel para data JavaScript
                    date = new Date((dateValue - 25569) * 86400 * 1000);
                } else if (typeof dateValue === 'string') {
                    date = new Date(dateValue);
                }
                
                // Verificar se a data é válida e está em um range razoável
                if (date && !isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2030) {
                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
                    const respName = record['Responsable'] || 'Não especificado';
                    if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                    monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
                } else {
                    // Data inválida - usar distribuição simulada
                    const currentDate = new Date();
                    const randomMonthsAgo = Math.floor(Math.random() * 12);
                    const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                    const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                    monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
                    const respName = record['Responsable'] || 'Não especificado';
                    if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                    monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
                }
            } catch (e) {
                // Erro ao processar data - usar distribuição simulada
                const currentDate = new Date();
                const randomMonthsAgo = Math.floor(Math.random() * 12);
                const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
                const respName = record['Responsable'] || 'Não especificado';
                if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
            }
        } else {
            // Sem data - usar distribuição simulada
            const currentDate = new Date();
            const randomMonthsAgo = Math.floor(Math.random() * 12);
            const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
            const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
            const respName = record['Responsable'] || 'Não especificado';
            if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
            monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
        }
    });

    // Ordenação e filtro de período para relatório mensal
    let sortedMonthlyEntries = Object.entries(monthlyStats);
    if (monthlyStart || monthlyEnd) {
        sortedMonthlyEntries = sortedMonthlyEntries.filter(([key]) => {
            if (key === 'Sem data') return false; // excluir "Sem data" quando filtrar por período
            const afterStart = monthlyStart ? key >= monthlyStart : true;
            const beforeEnd = monthlyEnd ? key <= monthlyEnd : true;
            return afterStart && beforeEnd;
        });
    }
    switch (monthlySort) {
        case 'period_asc':
            sortedMonthlyEntries.sort((a, b) => a[0].localeCompare(b[0]));
            break;
        case 'period_desc':
            sortedMonthlyEntries.sort((a, b) => b[0].localeCompare(a[0]));
            break;
        case 'count_asc':
            sortedMonthlyEntries.sort((a, b) => a[1] - b[1]);
            break;
        case 'count_desc':
        default:
            sortedMonthlyEntries.sort((a, b) => b[1] - a[1]);
            break;
    }
    
    // Prepare Top-5 managers by selected month
    const topMonthOptions = Object.keys(monthlyStats).sort((a,b) => b.localeCompare(a));
    const selectedTopMonth = (req.query.topMonth && topMonthOptions.includes(req.query.topMonth)) ? req.query.topMonth : (topMonthOptions[0] || '');
    let topManagerEntries = [];
    if (selectedTopMonth && monthlyResponsibles[selectedTopMonth]) {
        topManagerEntries = Object.entries(monthlyResponsibles[selectedTopMonth])
            .sort((a,b) => b[1] - a[1])
            .slice(0,5);
    }

    // Preview dos 5 registros mais recentes (com data válida), ordenados por data desc
    const recentPreviewData = processedData
        .filter(rec => !!rec._parsedDate)
        .sort((a,b) => b._parsedDate - a._parsedDate)
        .slice(0,5);

    // Alertas de follow-up: 2 semanas após o 3º e-mail enviado
    const isManager = (req.session.user?.role === 'gerente' || req.session.user?.role === 'manager');
    let followUpAlerts = [];
    if (isManager) {
        const now = new Date();
        const thresholdMs = 14 * 24 * 60 * 60 * 1000; // 14 dias
        followUpAlerts = filteredData
            .map(rec => {
                const third = rec['Third Email Sent'];
                if (!third) return null;
                const d = new Date(third);
                if (isNaN(d)) return null;
                const diffMs = now.getTime() - d.getTime();
                if (diffMs < thresholdMs) return null;
                return {
                    name: rec['Name'] || rec['Company'] || 'N/A',
                    website: rec['Website'] || rec['WEBSITE'] || rec['URL'] || '',
                    thirdEmailDate: third,
                    daysSince: Math.floor(diffMs / (24 * 60 * 60 * 1000)),
                    country: rec['Country'] || selectedCountry
                };
            })
            .filter(Boolean)
            .sort((a,b) => b.daysSince - a.daysSince);
    }

    const stats = {
        totalRecords: filteredData.length,
        categoryStats,
        responsibleStats,
        monthlyStats
    };
    // Ler pendências de aprovação
    const suppliersStore = readSuppliersStore();
    const pendingApprovals = suppliersStore.filter(item => item.status === 'pending_approval');
    // Base: tarefas de operador pendentes
    let operatorTasks = suppliersStore.filter(item => item.status === 'approved' && item.operatorTaskPending === true);
    // Se for operador, filtra apenas tarefas atribuídas a ele
    const _role = String(req.session.user?.role || '').toLowerCase();
    if (_role === 'operador' || _role === 'operator') {
        const userEmail = String(req.session.user?.email || '').toLowerCase();
        operatorTasks = operatorTasks.filter(item => String(item.operatorAssigned || '').toLowerCase() === userEmail);
    }
    const myRejected = suppliersStore.filter(item => item.status === 'rejected' && item.createdBy?.id === req.session.user?.id);
    
    console.log('[PRODUCTION DEBUG] Renderizando dashboard com stats:', {
        totalRecords: stats.totalRecords,
        categorias: Object.keys(stats.categoryStats).length,
        responsaveis: Object.keys(stats.responsibleStats).length,
        userEmail: req.session.user?.email,
        userRole: req.session.user?.role,
        pendingApprovals: pendingApprovals.length,
        operatorTasks: operatorTasks.length,
        myRejected: myRejected.length
    });
    
    // Get all users for the "Who will call" dropdown
    const allUsers = await userRepository.findAllAsync();
    
    res.render('dashboard', {
        user: req.session.user,
        allowedCountries,
        selectedCountry,
        stats,
        data: recentFilteredData,
        recentPreviewData,
        sortedMonthlyEntries,
        monthlySort: monthlySort || 'period_desc',
        monthlyStart: monthlyStart || '',
        monthlyEnd: monthlyEnd || '',
        topMonthOptions,
        selectedTopMonth,
        topManagerEntries,
        recentStart: recentStart || '',
        recentEnd: recentEnd || '',
        followUpAlerts,
        pendingApprovals,
        operatorTasks,
        myRejected,
        allUsers
    });
    
    console.log('[PRODUCTION DEBUG] Dashboard renderizado com sucesso');
    } catch (error) {
        console.error('[PRODUCTION DEBUG] Erro na rota dashboard:', error);
        console.error('[PRODUCTION DEBUG] Stack trace:', error.stack);
        res.status(500).render('error', { 
            error: 'Erro interno do servidor',
            user: req.session.user 
        });
    }
});

// Rota de detalhes de prioridade
app.get('/priority-details', requireAuth, requireManagerOrAdmin, (req, res) => {
    const existing = req.session.priorityDetails || {};
    res.render('priority-details', { user: req.session.user, details: existing });
});

app.post('/priority-details', requireAuth, requireManagerOrAdmin, (req, res) => {
    const body = req.body || {};
    req.session.priorityDetails = {
        monthlyRevenueSku: body.monthlyRevenueSku || '',
        avgFbaSellers: body.avgFbaSellers || '',
        avgSellers: body.avgSellers || '',
        amazonInStockRate: body.amazonInStockRate || '',
        additionalInfo: body.additionalInfo || '',
        whoWillCall: body.whoWillCall || '',
        callDate: body.callDate || '',
        result: body.result || '',
        followUpTask: body.followUpTask || '',
        needApproval: body.needApproval || 'no'
    };
    res.json({ success: true, message: 'Priority details saved in session.' });
});

app.get('/form', requireAuth, requireManagerOrAdmin, async (req, res) => {
    const users = await userRepository.findAllAsync();
    const managers = users.filter(u => (u.role === 'gerente' || u.role === 'manager'));
    const managersList = managers.map(u => ({ id: u.id, name: u.name, email: u.email }));     
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    res.render('form', { user: req.session.user, managersList, selectedCountry });
});

// UI de Bulk Upload
app.get('/bulk-upload', requireAuth, requireManagerOrAdmin, (req, res) => {
    return res.render('bulk-upload', { user: req.session.user });
});

// Rota de debug para verificar contagens por país diretamente do backend
app.get('/api/debug-counts', requireAuth, async (req, res) => {
    try {
        const allowedCountries = normalizeAllowedCountries(req.session.user?.allowedCountries);
        const selectedCountry = req.session.selectedCountry || (allowedCountries[0] || 'US');
    const us = await readDbData('US');
    const ca = await readDbData('CA');
    const mx = await readDbData('MX');
    const cn = await readDbData('CN');
        const allCount = us.length + ca.length + mx.length + cn.length;
            res.json({
                selectedCountry,
                counts: {
                    US: us.length,
                    CA: ca.length,
                    MX: mx.length,
                    CN: cn.length
                },
                source: 'database'
            });
    } catch (e) {
        console.error('[DEBUG] Erro em /api/debug-counts:', e);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Contagem por país no banco (suppliers_json)
app.get('/api/db-counts', requireAuth, async (req, res) => {
    if (!process.env.DATABASE_URL) {
        return res.status(400).json({ success: false, message: 'DATABASE_URL não configurado. Ative USE_DB/DATABASE_URL para consultar o banco.' });
    }
    const client = await pool.connect();
    try {
        const sql = `
            SELECT
              CASE
                WHEN LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) IN ('us','usa','united states','united states of america') THEN 'US'
                WHEN LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) IN ('ca','canada') THEN 'CA'
                WHEN LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) IN ('mx','mexico','méxico') THEN 'MX'
                WHEN LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) IN ('cn','china') THEN 'CN'
                ELSE 'UNK'
              END AS country_code,
              COUNT(*)::int AS count
            FROM suppliers_json
            GROUP BY country_code
            ORDER BY country_code;
        `;
        const { rows } = await client.query(sql);
        const total = rows.reduce((sum, r) => sum + (r.count || 0), 0);
        const byCountry = {};
        for (const r of rows) {
            byCountry[r.country_code] = r.count;
        }
        res.json({ success: true, total, byCountry });
    } catch (e) {
        console.error('[DB-COUNTS] Falha ao consultar contagem por país:', e);
        res.status(500).json({ success: false, error: e?.message || String(e) });
    } finally {
        client.release();
    }
});

// (Removido) Rota de contagem via Excel — usar /api/db-counts

// Health-check simples (sem autenticação) para validar servidor/porta
app.get('/healthz', (req, res) => {
    try {
        res.json({
            status: 'OK',
            ok: true,
            port: PORT,
            env: NODE_ENV,
            serverFile: __filename,
            serverDir: __dirname,
            viewsDir: app.get('views'),
            timestamp: new Date().toISOString()
        });
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message });
    }
});

// Compatibilidade com healthchecks que usam HEAD
app.head('/healthz', (req, res) => {
    try {
        res.status(200).end();
    } catch (e) {
        res.status(500).end();
    }
});

app.post('/add-record', requireAuth, requireManagerOrAdmin, async (req, res) => {
    if (REQUIRE_DB && !isDbEnabledForWrites()) {
        return res.status(503).json({ success: false, message: 'Banco de dados é obrigatório para escrever dados. Configure USE_DB/DATABASE_URL.' });
    }
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readDbData(selectedCountry);
    const allData = await readDbData('ALL');
    const normalizeWebsite = (s) => {
        let w = String(s || '').trim().toLowerCase();
        if (!w) return '';
        try {
            if (/^https?:\/\//.test(w)) {
                const u = new URL(w);
                w = u.hostname;
            } else {
                w = w.replace(/^www\./, '').split('/')[0];
            }
        } catch (_) {
            w = w.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        }
        w = w.replace(/:\d+$/, '');
        w = w.replace(/\.$/, '');
        return w;
    };

    // Helper robusto para obter o website do registro em diferentes esquemas
    const getWebsite = (rec) => {
        if (!rec) return '';
        const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
            || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
        return candidate || '';
    };
    const newRecord = {
        'Name': req.body.name,
        'Website': req.body.website,
        'CATEGORÍA': req.body.categoria,
        'Type': req.body.type,
        'Account Request Status': req.body.accountStatus,
        'DATE': req.body.date,
        'First Email Sent': req.body.firstEmailDate,
        'Second Email Sent': req.body.secondEmailDate,
        'Third Email Sent': req.body.thirdEmailDate,
        // Default Responsable to current user's name if not provided
        'Responsable': req.body.responsable || (req.session.user?.name || ''),
        'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)': req.body.status,
        'Description/Notes': req.body.description,
        'Contact Name': req.body.contactName,
        'Contact Phone': req.body.phone,
        'E-Mail': req.body.email,
        'Address': req.body.address,
        'Did you find a warehouse or truckload zone during your map search?': req.body.warehouseZoneFound,
        'User': req.body.user,
        'PASSWORD': req.body.password,
        'Inventory List': req.body.inventoryList,
        'Inventory List Comments': req.body.inventoryListComments,
        'LLAMAR': req.body.llamar,
        'PRIO (1 - TOP, 5 - bajo)': req.body.prioridade,
        'Comments': req.body.comments,
        'Country': selectedCountry,
        'Created_By_User_ID': req.session.user.id,
        'Created_By_User_Name': req.session.user.name,
        'Created_By_User_Email': req.session.user.email,
        'Created_At': new Date().toISOString()
    };
    // Validações: Nome e Website obrigatórios; Website deve ser único
    const nameVal = String(newRecord['Name'] || '').trim();
    const websiteVal = String(newRecord['Website'] || '').trim();
    if (!nameVal || !websiteVal) {
        return res.json({ success: false, message: 'Nome e Website são obrigatórios.' });
    }
    const newWebKey = normalizeWebsite(websiteVal);
    // Verificar duplicidade em TODOS os países, suportando diferentes esquemas de dados
    const duplicate = allData.find((rec) => normalizeWebsite(getWebsite(rec)) === newWebKey);
    if (duplicate) {
        return res.json({ success: false, message: 'Já existe um supplier com este website na base.' });
    }
    // Mesclar detalhes de prioridade salvos na sessão
    const priorityDetails = req.session.priorityDetails || null;
    if (priorityDetails) {
        newRecord['Priority: Monthly Revenue / SKU quantity'] = priorityDetails.monthlyRevenueSku || '';
        newRecord['Priority: Average FBA Sellers'] = priorityDetails.avgFbaSellers || '';
        newRecord['Priority: Average Sellers'] = priorityDetails.avgSellers || '';
        newRecord['Priority: Amazon In Stock Rate'] = priorityDetails.amazonInStockRate || '';
        newRecord['Priority: Additional Information'] = priorityDetails.additionalInfo || '';
        newRecord['Priority: Who will call'] = priorityDetails.whoWillCall || '';
        newRecord['Priority: Call Date'] = priorityDetails.callDate || '';
        newRecord['Priority: Result'] = priorityDetails.result || '';
        newRecord['Priority: Follow-up Task'] = priorityDetails.followUpTask || '';
        newRecord['Priority: Need Approval'] = priorityDetails.needApproval || 'no';
    }
    
    let saved = false;
    const useDb = isDbEnabledForWrites() && typeof insertJsonSupplier === 'function';
    if (useDb) {
        // Persist directly to DB JSONB table
        saved = await insertJsonSupplier(newRecord, selectedCountry, req.session.user);
    } else {
        return res.status(500).json({ success: false, message: 'Banco de dados não habilitado para escrita. Configure USE_DB/DATABASE_URL.' });
    }
    // Fluxo de aprovação: registros com prioridade High sempre precisam de aprovação
    try {
        const isHighPriority = req.body.prioridade === '1' || req.body.prioridade === 1;
        const needsApproval = priorityDetails && String(priorityDetails.needApproval).toLowerCase() === 'yes';
        
        if (isHighPriority || needsApproval) {
            const store = readSuppliersStore();
            const id = String(Date.now());
            store.push({
                id,
                status: 'pending_approval',
                distributor: newRecord,
                createdBy: { id: req.session.user.id, name: req.session.user.name },
                createdAt: new Date().toISOString(),
                reason: isHighPriority ? 'High Priority (1)' : 'Manual Approval Request'
            });
            writeSuppliersStore(store);
            console.log('[PRODUCTION DEBUG] Registro adicionado à lista de aprovação:', {
                id,
                reason: isHighPriority ? 'High Priority (1)' : 'Manual Approval Request',
                distributor: newRecord.Name
            });
        }
    } catch (e) {
        console.warn('Aviso: falha ao registrar pendência de aprovação:', e?.message);
    }
    // Limpar detalhes de prioridade da sessão após salvar
    req.session.priorityDetails = null;
    
    const pathUsed = useDb ? 'database' : (isGoogleDriveAvailable() ? 'googleDrive' : 'localExcel');
    if (saved) {
        res.json({ success: true, message: 'Record added successfully!', debug: { path: pathUsed, country: selectedCountry } });
    } else {
        res.json({ success: false, message: 'Error adding record.', debug: { path: pathUsed, country: selectedCountry } });
    }
});

// Rota para gerenciar usuários (apenas admin)
app.get('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await userRepository.findAllAsync();
        res.render('users', { 
            users: users,
            currentUser: req.session.user
        });
    } catch (e) {
        console.warn('Falha ao listar usuários:', e?.message || e);
        res.render('users', { users: [], currentUser: req.session.user });
    }
});

// Healthcheck detalhado para diagnóstico em produção (instantâneo, sem I/O bloqueante)
app.get('/health', (req, res) => {
    try {
        console.log('[HEALTH] GET /health', { ip: req.ip, ua: req.headers['user-agent'] });
        const roleCounts = {}; // não consulta DB para evitar atrasos
        res.status(200).json({
            status: 'ok',
            pid: process.pid,
            uptime_sec: Math.round(process.uptime()),
            node: process.version,
            port: process.env.PORT || 3000,
            env: {
                NODE_ENV: process.env.NODE_ENV || null,
                DATA_DIR: process.env.DATA_DIR || null,
                USE_DB_USERS: process.env.USE_DB_USERS || null,
                USE_DB: process.env.USE_DB || null,
                DATABASE_URL_present: !!process.env.DATABASE_URL
            },
            cwd: process.cwd(),
            viewsPath: app.get('views'),
            userSource: 'database',
            usersFilePath: null,
            usersCount: 0,
            roleCounts
        });
    } catch (e) {
        res.status(500).json({ status: 'error', message: e?.message });
    }
});

// Suporte a HEAD para healthcheck de plataformas que usam HEAD
app.head('/health', (req, res) => {
    try {
        console.log('[HEALTH] HEAD /health', { ip: req.ip, ua: req.headers['user-agent'] });
        res.status(200).end();
    } catch (_) {
        res.status(500).end();
    }
});

// API para criar usuário
app.post('/api/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const { name, email, password, role } = req.body;
        let { allowedCountries } = req.body;
        const validCountries = ['US', 'CA', 'MX'];
        if (typeof allowedCountries === 'string') {
            try {
                // Try parse JSON string or comma-separated
                allowedCountries = JSON.parse(allowedCountries);
            } catch (_) {
                allowedCountries = allowedCountries.split(',').map(s => s.trim());
            }
        }
        if (!Array.isArray(allowedCountries)) allowedCountries = [];
        allowedCountries = allowedCountries.filter(c => validCountries.includes((c || '').toUpperCase())).map(c => c.toUpperCase());
        
        // Verificar se email já existe
        const emailInUse = await userRepository.existsEmailAsync(email);
        if (emailInUse) {
            return res.json({ success: false, message: 'Email is already in use' });
        }
        
        // Criar novo usuário
        const newUser = await userRepository.createAsync({
            name,
            email,
            password,
            role,
            createdBy: req.session.user.id,
            allowedCountries: allowedCountries
        });
        // Auditoria: registrar criação de usuário (sem incluir senha)
        try {
            const actor = req.session?.user?.email || 'unknown';
            const details = JSON.stringify({ name: newUser.name, email: newUser.email, role: newUser.role, allowedCountries: newUser.allowedCountries });
            audit.logActivity('USER_CREATE', actor, newUser.email, details, req.ip);
        } catch (auditErr) {
            console.warn('Falha ao registrar auditoria de criação de usuário:', auditErr?.message || auditErr);
        }
        
        res.json({ success: true, user: newUser });
    } catch (error) {
        console.error('Error creating user:', error);
        res.status(500).json({ success: false, message: error?.message || 'Internal server error' });
    }
});

// API para editar usuário
app.put('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { name, email, password, role } = req.body;
        let { allowedCountries } = req.body;
        const validCountries = ['US', 'CA', 'MX'];
        if (typeof allowedCountries === 'string') {
            try {
                allowedCountries = JSON.parse(allowedCountries);
            } catch (_) {
                allowedCountries = allowedCountries.split(',').map(s => s.trim());
            }
        }
        if (!Array.isArray(allowedCountries)) allowedCountries = [];
        allowedCountries = allowedCountries.filter(c => validCountries.includes((c || '').toUpperCase())).map(c => c.toUpperCase());
        
        // Validações básicas
        if (!name || !email || !role) {
            return res.json({ success: false, message: 'Name, email and role are required' });
        }
        
        // Verificar se email já existe (exceto para o próprio usuário)
        const existingUser = await userRepository.findByEmailAsync(email);
        if (existingUser && existingUser.id !== userId) {
            return res.json({ success: false, message: 'This email is already in use by another user' });
        }
        
        // Atualizar usuário
        const updatedUser = await userRepository.updateAsync(userId, {
            name,
            email,
            password, // Será undefined se não fornecida
            role,
            allowedCountries
        });
        
        if (updatedUser) {
            res.json({ success: true, user: updatedUser });
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error editing user:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

// API para deletar usuário
app.delete('/api/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUserId = req.session.user.id;
        
        // Não permitir que admin delete a si mesmo
        if (userId === currentUserId) {
            return res.json({ success: false, message: 'You cannot delete your own account' });
        }
        
        const success = await userRepository.deleteAsync(userId);
        
        if (success) {
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

// Atualizar perfil do próprio usuário (nome e senha)
app.put('/api/me', requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { name, currentPassword, newPassword } = req.body || {};

        const user = await userRepository.findByIdAsync(userId);
        if (!user) {
            return res.json({ success: false, message: 'User not found' });
        }

        // Preparar dados de atualização
        const updateData = {};
        if (typeof name === 'string' && name.trim().length > 0) {
            updateData.name = name.trim();
        }

        if (typeof newPassword === 'string' && newPassword.trim().length > 0) {
            // Exigir senha atual correta para alterar a senha
            if (!currentPassword || !User.comparePassword(currentPassword, user.password)) {
                return res.json({ success: false, message: 'Current password is invalid' });
            }
            updateData.password = newPassword.trim();
        }

        // Nada para atualizar
        if (Object.keys(updateData).length === 0) {
            return res.json({ success: false, message: 'No changes to apply' });
        }

        const updatedUser = await userRepository.updateAsync(userId, updateData);
        if (updatedUser) {
            // Sincronizar sessão com novo nome, se alterado
            if (updateData.name) {
                req.session.user.name = updatedUser.name;
            }
            return res.json({
                success: true,
                user: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    role: updatedUser.role,
                    allowedCountries: updatedUser.allowedCountries
                }
            });
        }
        return res.json({ success: false, message: 'Failed to update profile' });
    } catch (error) {
        console.error('Error updating own profile:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

// Rota de busca
app.get('/search', requireAuth, requireRole(['operator','admin','manager']), async (req, res) => {
    const { query, type } = req.query;
    // Garantir que buscas respeitem o país selecionado na sessão
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    let data = await readDbData(selectedCountry);
    
    // Helpers definidos ANTES do uso para evitar erros de TDZ
    const normalize = (s) => ((s || '') + '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/\s+/g, ' ').trim();

    const getField = (record, keys) => {
        // Busca robusta: tenta casar nomes de campos ignorando acentos, caixa, espaços e pontuação
        const normalizeKey = (s) => ((s || '') + '')
            .toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9]+/g, '')
            .trim();
        const wanted = new Set(keys.map(k => normalizeKey(k)));
        for (const k of Object.keys(record)) {
            const nk = normalizeKey(k);
            if (wanted.has(nk)) {
                const v = record[k];
                if (v !== undefined && v !== null && ((v + '').trim().length > 0)) {
                    return v;
                }
            }
        }
        // fallback: tentativa direta com as chaves fornecidas
        for (const k of keys) {
            const v = record[k];
            if (v !== undefined && v !== null && ((v + '').trim().length > 0)) {
                return v;
            }
        }
        return '';
    };

    // Construir mapas de índice por país para links de edição corretos
    const normalizeKey = (s) => ((s || '') + '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '')
        .trim();
    const countryCodes = ['US', 'CA', 'MX'];
    const countryIndexMaps = {};
    for (const cc of countryCodes) {
        try {
    const arr = await readDbData(cc);
            const byWeb = new Map();
            const byName = new Map();
            arr.forEach((r, idx) => {
                const web = normalizeKey(getField(r, ['Website']));
                const name = normalizeKey(getField(r, ['Name']));
                if (web) byWeb.set(web, idx);
                if (name) byName.set(name, idx);
            });
            countryIndexMaps[cc] = { byWeb, byName };
        } catch (e) {
            countryIndexMaps[cc] = { byWeb: new Map(), byName: new Map() };
        }
    }

    // Adicionar índice real (ALL) e índice por país a cada registro
    data = data.map((record, index) => {
        const countryRaw = getField(record, ['Country']);
        // Fallback para o país atualmente selecionado, evitando default para US quando o campo está vazio/irregular
        const countryCode = normalizeCountryCode(countryRaw) || selectedCountry;
        const webKey = normalizeKey(getField(record, ['Website']));
        const nameKey = normalizeKey(getField(record, ['Name']));
        const maps = countryIndexMaps[countryCode] || { byWeb: new Map(), byName: new Map() };
        let idxCountry = null;
        if (webKey && maps.byWeb.has(webKey)) {
            idxCountry = maps.byWeb.get(webKey);
        } else if (nameKey && maps.byName.has(nameKey)) {
            idxCountry = maps.byName.get(nameKey);
        }
        return {
            ...record,
            _realIndex: index,
            _realIndexCountry: typeof idxCountry === 'number' ? idxCountry : index,
            _countryCode: countryCode
        };
    });
    
    // Correlação: enriquecer registros com Created_By_* quando o responsable mencionar um usuário gerencial
    try {
        let managers = [];
        try {
            const allUsers = await userRepository.findAllAsync();
            managers = Array.isArray(allUsers)
                ? allUsers.filter(u => (u.role === 'gerente' || u.role === 'manager') && !!u.isActive)
                : [];
        } catch (_) {
            managers = [];
        }
        const candidates = managers.map(u => ({
            id: Number(u.id),
            name: (u.name || '').toString(),
            email: (u.email || '').toString(),
            nameLc: (u.name || '').toString().toLowerCase(),
            emailLc: (u.email || '').toString().toLowerCase()
        }));
        if (candidates.length > 0) {
            data = data.map(record => {
                const responsibleRaw = getField(record, ['Responsable','Manager','Buyer']);
                const responsible = ((responsibleRaw || '') + '').toLowerCase();
                const createdById = Number(record['Created_By_User_ID'] || record.Created_By_User_ID || 0);
                const createdByName = ((record['Created_By_User_Name'] || record.Created_By_User_Name || '') + '').toLowerCase();
                if (!createdById) {
                    const match = candidates.find(c => responsible.includes(c.nameLc) || responsible.includes(c.emailLc));
                    if (match) {
                        record['Created_By_User_ID'] = match.id;
                        record['Created_By_User_Name'] = match.name;
                    }
                } else if (!createdByName) {
                    const match = candidates.find(c => c.id === createdById);
                    if (match) {
                        record['Created_By_User_Name'] = match.name;
                    }
                }
                return record;
            });
        }
    } catch (e) {
        console.warn('[correlate][runtime] Não foi possível enriquecer Created_By_*:', e?.message || e);
    }
    
    // Para gerentes, mostrar todos os distribuidores mas com campos limitados para os que não são responsáveis
    if (['gerente','manager'].includes(String(req.session.user.role || '').toLowerCase())) {
        // Não filtrar os dados, mas marcar quais são do usuário para controle de exibição
        const user = { id: req.session.user.id, name: req.session.user.name, email: req.session.user.email };
        data = data.map(record => {
            const mentionSource = extractManagerLikeValue(record);
            const createdById = Number(record['Created_By_User_ID'] || record.Created_By_User_ID || 0);
            const createdByName = ((record['Created_By_User_Name'] || record.Created_By_User_Name || '') + '').toLowerCase();
            const byMention = isUserMentionedIn(mentionSource, user);
            const byCreated = (!!user.id && createdById === Number(user.id)) || (createdByName && createdByName.includes(String(user.name || '').toLowerCase()));
            const isResponsible = byMention || byCreated;
            return { ...record, _isResponsible: !!isResponsible };
        });
    } else if (req.session.user.role !== 'admin') {
        // Para outros usuários não-admin:
        // Sempre permitir visualizar todos os registros, marcando _isResponsible para controle de exibição
        const user = { id: req.session.user.id, name: req.session.user.name, email: req.session.user.email };
        data = data.map(record => {
            const mentionSource = extractManagerLikeValue(record);
            const createdById = Number(record['Created_By_User_ID'] || record.Created_By_User_ID || 0);
            const createdByName = ((record['Created_By_User_Name'] || record.Created_By_User_Name || '') + '').toLowerCase();
            const byMention = isUserMentionedIn(mentionSource, user);
            const byCreated = (!!user.id && createdById === Number(user.id)) || (createdByName && createdByName.includes(String(user.name || '').toLowerCase()));
            const isResponsible = byMention || byCreated;
            return { ...record, _isResponsible: !!isResponsible };
        });
    }
    
    // Novos filtros: Account Status, Buyer, Category e Status + ordenação
    const { accountStatus = '', buyer = '', category = '', status = '', sortBy = '', sortDirection = 'asc', view = 'grid', submitted = '', listAll = '' } = req.query;
    const list = (req.query.list || '');
    console.log('[SEARCH DEBUG] Params:', { query, type, accountStatus, buyer, category, status, sortBy, sortDirection, view, submitted, listAll, list });

    // Normalização e getField já declarados acima no início da rota /search para evitar TDZ e duplicações.

    const fieldStatusName = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';

    const hasAdvancedFilters = [accountStatus, buyer, category, status].some(v => v && v.trim().length > 0);
    console.log('[SEARCH DEBUG] Role:', req.session.user.role, 'hasAdvancedFilters:', hasAdvancedFilters);

    // Resultado do termo de busca (query)
    let resultsQuery = [];
    const qNorm = normalize(query || '');
    const isAllQuery = qNorm === 'all' || qNorm === 'todos' || qNorm === 'tudo' || qNorm === '*';
    if (isAllQuery) {
        // Consulta especial: "ALL/TODOS/TUDO/*" retorna todos os registros
        resultsQuery = data;
        console.log('[SEARCH DEBUG] Special ALL-like query: returning all records');
    } else if (query && (query + '').trim()) {
        const q = qNorm;
        // Aliases para nomes próprios (ex.: Nacho -> Ignacio)
        const qAliases = [q, ...(q === 'nacho' ? ['ignacio'] : [])];
        resultsQuery = data.filter(record => {
            const nameNorm = normalize(record.Name);
            const webNorm = normalize(record.Website);
            const catNorm = normalize(getField(record, ['CATEGORÍA','Category']));
            const mgrNorm = normalize(getField(record, ['Responsable','Manager','Buyer']));
            switch (type) {
                case 'name':
                    return !!nameNorm && nameNorm.includes(q);
                case 'website':
                    return !!webNorm && webNorm.includes(q);
                case 'categoria':
                    return !!catNorm && catNorm.includes(q);
                case 'manager':
                    return !!mgrNorm && qAliases.some(a => mgrNorm.includes(a));
                default:
                    return (!!nameNorm && nameNorm.includes(q)) ||
                           (!!webNorm && webNorm.includes(q)) ||
                           (!!catNorm && catNorm.includes(q)) ||
                           (!!mgrNorm && qAliases.some(a => mgrNorm.includes(a)));
            }
        });
        console.log('[SEARCH DEBUG] resultsQuery count:', resultsQuery.length, 'query:', q);
    }

    // Resultado dos filtros avançados
    let resultsAdvanced = data;
    let buyerFilterCount = null;
    if (hasAdvancedFilters) {
        // buyer/manager alias-aware, with special "__blank__" to find empty fields
        if (typeof req.query.buyer === 'string' && req.query.buyer.trim().length > 0) {
            const before = resultsAdvanced.length;
            if (req.query.buyer === '__blank__') {
                resultsAdvanced = resultsAdvanced.filter(record => (((getField(record, ['Responsable','Manager','Buyer']) || '') + '').trim().length === 0));
                console.log('[SEARCH DEBUG] buyer blank filter applied. before:', before, 'after:', resultsAdvanced.length);
            } else {
                const buyerTerm = normalize(req.query.buyer);
                const buyerAliases = [buyerTerm, ...(buyerTerm === 'nacho' ? ['ignacio'] : [])];
                resultsAdvanced = resultsAdvanced.filter(record => {
                    const mgrNorm = normalize(getField(record, ['Responsable','Manager','Buyer']));
                    return !!mgrNorm && buyerAliases.some(a => mgrNorm.includes(a));
                });
                console.log('[SEARCH DEBUG] resultsAdvanced buyer alias count:', resultsAdvanced.length, 'buyerTerm:', buyerTerm, 'before:', before);
            }
            buyerFilterCount = resultsAdvanced.length;
        }
        if (category && category.trim()) {
            const term = normalize(category);
            const before = resultsAdvanced.length;
            resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, ['CATEGORÍA','Category'])).includes(term));
            console.log('[SEARCH DEBUG] category filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
        }
        if (accountStatus && accountStatus.trim()) {
            const before = resultsAdvanced.length;
            if (accountStatus === '__blank__') {
                resultsAdvanced = resultsAdvanced.filter(record => (((getField(record, ['Account Request Status','Account Status']) || '') + '').trim().length === 0));
                console.log('[SEARCH DEBUG] accountStatus blank filter applied. before:', before, 'after:', resultsAdvanced.length);
            } else {
                const term = normalize(accountStatus);
                resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, ['Account Request Status','Account Status'])) === term);
                console.log('[SEARCH DEBUG] accountStatus filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
            }
        }
        if (status && status.trim()) {
            const before = resultsAdvanced.length;
            if (status === '__blank__') {
                // Considerar "em branco" quando NÃO houver valor em nenhum dos campos de status
                resultsAdvanced = resultsAdvanced.filter(record => {
                    const sGeneral = (((getField(record, [fieldStatusName]) || '') + '').trim());
                    const sAccount = (((getField(record, ['Account Request Status','Account Status']) || '') + '').trim());
                    return sGeneral.length === 0 && sAccount.length === 0;
                });
                console.log('[SEARCH DEBUG] status blank filter applied (general + account). before:', before, 'after:', resultsAdvanced.length);
            } else {
                const term = normalize(status);
                // Aceitar correspondência em STATUS geral OU em Account Status
                resultsAdvanced = resultsAdvanced.filter(record => {
                    const sGeneral = normalize(getField(record, [fieldStatusName]));
                    const sAccount = normalize(getField(record, ['Account Request Status','Account Status']));
                    return sGeneral === term || sAccount === term;
                });
                console.log('[SEARCH DEBUG] status filter term (general or account):', term, 'before:', before, 'after:', resultsAdvanced.length);
            }
        }
    }

    // Combinar resultados (interseção) quando houver filtros avançados e termo de busca
    let results;
    const forceAll = isAllQuery || (submitted === '1' && !((query || '').trim()) && !hasAdvancedFilters);
    if (listAll === '1' || ((list || '').toLowerCase() === 'all')) {
        // When user requests "List ALL", return all but still respect advanced filters if present
        results = hasAdvancedFilters ? resultsAdvanced : data;
        console.log('[SEARCH DEBUG] ListALL requested (listAll/list): returning', hasAdvancedFilters ? 'advanced-filtered results' : 'all records');
    } else if (forceAll) {
        results = data;
        console.log('[SEARCH DEBUG] Force ALL results: returning all records (special ALL or submitted empty)');
    } else if (hasAdvancedFilters && (query && query.trim())) {
        const idsAdvanced = new Set(resultsAdvanced.map(r => r._realIndex));
        results = resultsQuery.filter(r => idsAdvanced.has(r._realIndex));
    } else if (hasAdvancedFilters) {
        results = resultsAdvanced;
    } else if (query && query.trim()) {
        results = resultsQuery;
    } else {
        results = data;
    }

    console.log('[SEARCH DEBUG] Combined (intersection) results count:', results.length);
    
    // Ordenação por campo, se solicitado
    if (sortBy && ['accountStatus','status','buyer','category'].includes(sortBy)) {
        const fieldMap = {
            accountStatus: ['Account Request Status','Account Status'],
            status: ['STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)','Account Request Status','Account Status'],
            buyer: ['Responsable','Manager','Buyer'],
            category: ['CATEGORÍA','Category']
        };
        const fieldKeys = fieldMap[sortBy];
        const dir = (sortDirection || 'asc').toLowerCase() === 'desc' ? 'desc' : 'asc';
        results.sort((a, b) => {
            const av = normalize(getField(a, fieldKeys));
            const bv = normalize(getField(b, fieldKeys));
            if (av < bv) return dir === 'desc' ? 1 : -1;
            if (av > bv) return dir === 'desc' ? -1 : 1;
            return 0;
        });
        console.log('[SEARCH DEBUG] Sorted by', sortBy, 'direction', sortDirection);
    }
    
    // Listas pré-definidas para os filtros (valores únicos)
    const collectUniqueValues = (records, fieldKeys) => {
        const map = new Map();
        for (const r of records) {
            const raw = getField(r, fieldKeys);
            const val = ((raw || '') + '').trim();
            if (!val) continue;
            const key = normalize(val);
            if (!map.has(key)) map.set(key, val);
        }
        return Array.from(map.values()).sort((a, b) => a.localeCompare(b));
    };
    
    const managersList = collectUniqueValues(data, ['Responsable','Manager','Buyer']);
    const accountStatusList = collectUniqueValues(data, ['Account Request Status','Account Status']);
    // Lista dinâmica de STATUS unificada (Status geral + Account Status)
    const statusListGeneral = collectUniqueValues(data, [fieldStatusName]);
    const statusList = Array.from(new Set([...(statusListGeneral || []), ...(accountStatusList || [])]))
        .filter(v => (v || '').trim().length > 0)
        .sort((a, b) => a.localeCompare(b));
    
    // Persistir contadores de debug na sessão e adicionar rota /logs que renderiza a nova aba de Logs. Remover envio de debugCounts para a página de busca.
    const debugCounts = {
        resultsQueryCount: resultsQuery ? resultsQuery.length : 0,
        resultsAdvancedBuyerAliasCount: buyerFilterCount,
        combinedResultsCount: results.length
    };
    req.session.lastSearchDebugCounts = debugCounts;
    
    res.render('search', { 
        results: results, 
        query: query || '', 
        type: type || 'all',
        user: req.session.user,
        selectedCountry,
        // filtros removidos da UI, permanecem aqui apenas para compatibilidade
        accountStatus,
        buyer,
        category,
        status,
        sortBy,
        sortDirection,
        view,
        submitted,
        managersList,
        accountStatusList,
        statusList,
        listAll
    });
});

// Rota GET para exibir formulário de edição
app.get('/edit/:id', requireAuth, async (req, res) => {
    const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readDbData(selectedCountry);
    const recordId = parseInt(req.params.id);
    const user = req.session.user;
    
    // Verificar se o registro existe
    if (recordId < 0 || recordId >= data.length) {
        return res.status(404).render('error', { 
            message: 'Record not found',
            user: user
        });
    }
    
    const record = data[recordId];

    // Permissão: Admin, Owner (criador) ou Marcelo se for responsável pelo registro
    const roleNorm = normalizeRole(user.role);
    const createdByIdOk = record.Created_By_User_ID && String(record.Created_By_User_ID).trim() === String(user.id).trim();
    const createdByNameOk = record.Created_By_User_Name && String(record.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
    const createdByEmailOk = record.Created_By_User_Email && String(record.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
    const isOwner = !!(createdByIdOk || createdByNameOk || createdByEmailOk);
    const isMarcelo = String(user?.email || '').toLowerCase() === 'marcelogalvis@mylokok.com';
    const mentionSourceEdit = extractManagerLikeValue(record);
    const isResponsibleMarcelo = isMarcelo && (isUserMentionedIn(mentionSourceEdit, user) || isOwner);
    if (roleNorm !== 'admin' && !isOwner && !isResponsibleMarcelo) {
        return res.status(403).render('error', {
            message: 'Access denied. Only the record owner (or admin) can edit.',
            user: user
        });
    }
    
    res.render('edit', { 
        record: record,
        recordId: recordId,
        user: user
    });
});

// Rota POST para processar alterações
app.post('/edit/:id', requireAuth, async (req, res) => {
    if (REQUIRE_DB && !isDbEnabledForWrites()) {
        return res.status(503).json({ success: false, message: 'Banco de dados é obrigatório para editar dados. Configure USE_DB/DATABASE_URL.' });
    }
    const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readDbData(selectedCountry);
    const allData = await readDbData('ALL');
    const recordId = parseInt(req.params.id);
    const user = req.session.user;
    
    // Verificar se o registro existe
    if (recordId < 0 || recordId >= data.length) {
        return res.status(404).json({ success: false, message: 'Record not found' });
    }
    
    const record = data[recordId];
    
    // Verificar permissões novamente: Admin, Owner ou Marcelo se for responsável
    const roleNormPost = normalizeRole(user.role);
    const createdByIdOk = record.Created_By_User_ID && String(record.Created_By_User_ID).trim() === String(user.id).trim();
    const createdByNameOk = record.Created_By_User_Name && String(record.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
    const createdByEmailOk = record.Created_By_User_Email && String(record.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
    const isOwnerPost = !!(createdByIdOk || createdByNameOk || createdByEmailOk);
    const isMarceloPost = String(user?.email || '').toLowerCase() === 'marcelogalvis@mylokok.com';
    const mentionSourcePost = extractManagerLikeValue(record);
    const isResponsibleMarceloPost = isMarceloPost && (isUserMentionedIn(mentionSourcePost, user) || isOwnerPost);
    if (roleNormPost !== 'admin' && !isOwnerPost && !isResponsibleMarceloPost) {
        return res.status(403).json({ 
            success: false, 
            message: 'Access denied. Only the record owner (or admin) can edit.' 
        });
    }
    
    // Helpers de validação
    const normalizeWebsite = (s) => {
        let w = String(s || '').trim().toLowerCase();
        if (!w) return '';
        try {
            if (/^https?:\/\//.test(w)) {
                const u = new URL(w);
                w = u.hostname;
            } else {
                w = w.replace(/^www\./, '').split('/')[0];
            }
        } catch (_) {
            w = w.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        }
        w = w.replace(/:\d+$/, '');
        w = w.replace(/\.$/, '');
        return w;
    };

    // Obter website considerando esquemas alternativos (compatível com dados antigos)
    const getWebsite = (rec) => {
        if (!rec) return '';
        const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
            || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
        return candidate || '';
    };

    // Atualizar os campos do registro
    const {
        name,
        website,
        categoria,
        type,
        accountRequestStatus,
        status,
        generalStatus,
        responsable,
        description,
        comments,
        llamar,
        prioridade,
        firstEmailDate,
        secondEmailDate,
        thirdEmailDate,
        contactName,
        contactEmail,
        contactPhone,
        address,
        inventoryList,
        inventoryListComments,
        warehouseZoneFound,
        user: accessUser,
        password: accessPassword,
        city,
        state,
        country,
        zipCode
    } = req.body;

    // Validar obrigatoriedade e unicidade (Website)
    const candidateName = name !== undefined ? String(name).trim() : String(record.Name || '').trim();
    const candidateWebsite = website !== undefined ? String(website).trim() : String(record.Website || '').trim();
    if (!candidateName || !candidateWebsite) {
        return res.status(400).json({ success: false, message: 'Nome e Website são obrigatórios.' });
    }
    const websiteKey = normalizeWebsite(candidateWebsite);
    // Procurar duplicidade em TODOS os países, ignorando o próprio registro
    const isSameRecord = (rec) => {
        const sameCreated = rec['Created_At'] && record['Created_At'] && String(rec['Created_At']) === String(record['Created_At']);
        const sameIdentity = normalizeWebsite(getWebsite(rec)) === normalizeWebsite(getWebsite(record))
            && String(rec['Name'] || '').trim() === String(record['Name'] || '').trim()
            && String(rec['Country'] || '').trim() === String(record['Country'] || '').trim();
        return sameCreated || sameIdentity;
    };
    const duplicate = allData.find((rec) => !isSameRecord(rec) && normalizeWebsite(getWebsite(rec)) === websiteKey);
    if (duplicate) {
        return res.status(400).json({ success: false, message: 'Já existe outro supplier com o mesmo website.' });
    }
    
    // Atualizar apenas os campos fornecidos
    if (name !== undefined) data[recordId].Name = name;
    if (website !== undefined) data[recordId].Website = website;
    if (categoria !== undefined) data[recordId]['CATEGORÍA'] = categoria;
    if (type !== undefined) data[recordId]['Type'] = type;
    if (accountRequestStatus !== undefined) data[recordId]['Account Request Status'] = accountRequestStatus;
    // Atualizar o STATUS geral no cabeçalho oficial da planilha
    const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
    if (status !== undefined) data[recordId][STATUS_HEADER] = status;
    // Manter compatibilidade com possíveis campos antigos
    if (generalStatus !== undefined) data[recordId]['General Status'] = generalStatus;
    if (responsable !== undefined) data[recordId].Responsable = responsable;
    if (description !== undefined) data[recordId]['Description/Notes'] = description;
    if (contactName !== undefined) data[recordId]['Contact Name'] = contactName;
    if (contactEmail !== undefined) {
        // Atualizar ambos cabeçalhos usados no sistema
        data[recordId]['Contact Email'] = contactEmail;
        data[recordId]['E-Mail'] = contactEmail;
    }
    if (contactPhone !== undefined) data[recordId]['Contact Phone'] = contactPhone;
    if (address !== undefined) data[recordId].Address = address;
    if (warehouseZoneFound !== undefined) {
        data[recordId]['Did you find a warehouse or truckload zone during your map search?'] = warehouseZoneFound;
    }
    if (inventoryList !== undefined) data[recordId]['Inventory List'] = inventoryList;
    if (inventoryListComments !== undefined) data[recordId]['Inventory List Comments'] = inventoryListComments;
    if (comments !== undefined) data[recordId]['Comments'] = comments;
    if (llamar !== undefined) data[recordId]['LLAMAR'] = llamar;
    if (prioridade !== undefined) data[recordId]['PRIO (1 - TOP, 5 - bajo)'] = prioridade;
    if (firstEmailDate !== undefined) data[recordId]['First Email Sent'] = firstEmailDate;
    if (secondEmailDate !== undefined) data[recordId]['Second Email Sent'] = secondEmailDate;
    if (thirdEmailDate !== undefined) data[recordId]['Third Email Sent'] = thirdEmailDate;
    if (typeof accessUser !== 'undefined') data[recordId]['User'] = accessUser;
    if (typeof accessPassword !== 'undefined') data[recordId]['PASSWORD'] = accessPassword;
    if (city !== undefined) data[recordId].City = city;
    if (state !== undefined) data[recordId].State = state;
    if (country !== undefined) data[recordId].Country = country;
    if (zipCode !== undefined) data[recordId]['Zip Code'] = zipCode;
    
    // Auditoria de atualização
    try {
        data[recordId]['Updated_At'] = new Date().toISOString();
        data[recordId]['Updated_By_User_Name'] = user?.name || '';
        data[recordId]['Updated_By_User_ID'] = user?.id || '';
    } catch (_) {
        // continuar mesmo se falhar
    }

    // Persistir alterações (prioriza DB quando habilitado). Quando DB está ativo, NÃO fazer fallback para Excel
    const canUseDb = isDbEnabledForWrites() && typeof updateJsonSupplier === 'function';
    let saveSuccess = false;
    if (canUseDb) {
        try {
            // record é o estado anterior carregado; data[recordId] é o atualizado
            saveSuccess = await updateJsonSupplier(record, data[recordId], selectedCountry);
            if (!saveSuccess) {
                console.warn('[EDIT] Falha ao localizar/atualizar registro no DB. Sem fallback para Excel (fonte ativa: banco).');
                return res.status(409).json({ 
                    success: false, 
                    message: 'Não foi possível localizar o registro no banco para atualizar. Verifique Nome, Website e Country.',
                    hint: {
                        selectedCountry,
                        name: data[recordId]?.Name || null,
                        website: data[recordId]?.Website || null
                    }
                });
            }
        } catch (e) {
            console.error('[EDIT] Erro ao atualizar no DB:', e?.message);
            return res.status(500).json({ success: false, message: 'Erro ao atualizar no banco de dados.', error: e?.message });
        }
    } else {
        return res.status(500).json({ success: false, message: 'Banco de dados não habilitado para escrita. Configure USE_DB/DATABASE_URL.' });
    }
    if (!saveSuccess) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error saving changes to storage. Please try again.' 
        });
    }
    
    res.json({ success: true, message: 'Record updated successfully!' });
});

// Rota DELETE para remover um registro
app.delete('/records/:id', requireAuth, async (req, res) => {
    if (REQUIRE_DB && !isDbEnabledForWrites()) {
        return res.status(503).json({ success: false, message: 'Banco de dados é obrigatório para excluir dados. Configure USE_DB/DATABASE_URL.' });
    }
    try {
        const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readDbData(selectedCountry);
        const recordId = parseInt(req.params.id);
        const user = req.session.user;

        if (Number.isNaN(recordId) || recordId < 0 || recordId >= data.length) {
            return res.status(404).json({ success: false, message: 'Record not found' });
        }

        const record = data[recordId];

        // Permissão: Admin, Owner ou Marcelo se for responsável
        const roleNormDel = normalizeRole(user.role);
        const createdByIdOkDel = record.Created_By_User_ID && String(record.Created_By_User_ID).trim() === String(user.id).trim();
        const createdByNameOkDel = record.Created_By_User_Name && String(record.Created_By_User_Name).toLowerCase().includes(String(user.name || '').toLowerCase());
        const createdByEmailOkDel = record.Created_By_User_Email && String(record.Created_By_User_Email).toLowerCase() === String(user.email || '').toLowerCase();
        const isOwnerDel = !!(createdByIdOkDel || createdByNameOkDel || createdByEmailOkDel);
        const isMarceloDel = String(user?.email || '').toLowerCase() === 'marcelogalvis@mylokok.com';
        const mentionSourceDel = extractManagerLikeValue(record);
        const isResponsibleMarceloDel = isMarceloDel && (isUserMentionedIn(mentionSourceDel, user) || isOwnerDel);
        if (roleNormDel !== 'admin' && !isOwnerDel && !isResponsibleMarceloDel) {
            return res.status(403).json({ success: false, message: 'Access denied. Only the record owner (or admin) can delete.' });
        }

        // Persistência: prioriza DB quando habilitado; quando DB está ativo, NÃO fazer fallback para Excel
        const canUseDb = isDbEnabledForWrites() && typeof require('./database').deleteJsonSupplier === 'function';
        let saveSuccess = false;
        if (canUseDb) {
            try {
                const { deleteJsonSupplier } = require('./database');
                saveSuccess = await deleteJsonSupplier(record, selectedCountry);
                if (!saveSuccess) {
                    console.warn('[DELETE] Falha ao localizar/deletar registro no DB. Sem fallback para Excel (fonte ativa: banco).');
                    return res.status(409).json({
                        success: false,
                        message: 'Falha ao identificar registro no banco para exclusão. Atualize a página e tente novamente.'
                    });
                }
            } catch (e) {
                console.error('[DELETE] Erro ao deletar no DB:', e?.message);
                return res.status(500).json({ success: false, message: 'Erro ao deletar no banco de dados.', error: e?.message });
            }
        } else {
            // Excel direto
            data.splice(recordId, 1);
            saveSuccess = await writeExcelData(data, selectedCountry);
        }

        if (!saveSuccess) {
            return res.status(500).json({ success: false, message: 'Error deleting record. Please try again.' });
        }

        return res.json({ success: true, message: 'Record deleted successfully.' });
    } catch (error) {
        console.error('Error in DELETE /records/:id', error);
        return res.status(500).json({ success: false, message: 'Unexpected server error while deleting record.' });
    }
});

// Rota de download de template Excel
app.get('/download-template', requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
        const headers = [
            'Name', 'CATEGORÍA', 'Website', 'Account Request Status', 'DATE', 'Responsable',
            'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)',
            'Description/Notes', 'Contact Name', 'Contact Phone', 'E-Mail', 'Address',
            'User', 'PASSWORD', 'LLAMAR', 'PRIO (1 - TOP, 5 - bajo)', 'Comments'
        ];

        const wb = XLSX.utils.book_new();
        const makeSheet = (title) => {
            const ws = XLSX.utils.aoa_to_sheet([headers]);
            ws['!cols'] = headers.map(h => ({ wch: Math.max(12, Math.min(36, h.length + 4)) }));
            XLSX.utils.book_append_sheet(wb, ws, title);
        };

        // Criar abas para países suportados, facilitando inferência de país no upload
        makeSheet('US Suppliers');
        makeSheet('Canada Suppliers');
        makeSheet('Mexico Suppliers');
        makeSheet('China Suppliers');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="suppliers_template.xlsx"');
        return res.status(200).send(buffer);
    } catch (e) {
        console.error('Error generating template:', e);
        return res.status(500).send('Failed to generate template.');
    }
});

// (Removida) rota antiga de bulk-upload com fallback para Excel

// Atualizar bulk-upload para usar DB como fonte principal quando habilitado
app.post('/bulk-upload', requireAuth, requireManagerOrAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        const user = req.session.user;
        const file = req.file || (req.files?.excelFile);
        if (!file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
        }
        const buffer = file.buffer || file.data;
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const canUseDb = isDbEnabledForWrites();

        if (canUseDb) {
            const { upsertJsonSupplier } = require('./database');
            let inserted = 0, updated = 0, errors = 0;
            const warnings = [];
            // Inferir país a partir do sheet name
            const normalized = String(sheetName || '').trim().toLowerCase();
            let inferredCountry = null;
            if (normalized.includes('lokok') || normalized.includes('usa') || normalized.includes('united states')) inferredCountry = 'US';
            else if (normalized.includes('canada')) inferredCountry = 'CA';
            else if (normalized.includes('mexico')) inferredCountry = 'MX';
            else if (normalized.includes('china')) inferredCountry = 'CN';

            for (const row of rows) {
                try {
                    // Avisos para campos obrigatórios ausentes
                    if (!String(row['Name'] || '').trim()) {
                        warnings.push('Linha sem Name informada. Registro não inserido.');
                        errors++;
                        continue;
                    }
                    if (!String(row['CATEGORÍA'] || '').trim()) {
                        warnings.push(`Registro "${row['Name']}" sem CATEGORÍA. Prosseguindo com upsert.`);
                    }
                    // Garantir auditoria mínima quando possível
                    if (!row['Created_At'] && !row['Created At'] && !row['DATE'] && !row['Date']) {
                        row['Created_At'] = new Date().toISOString();
                        row['Created_By_User_ID'] = user?.id || null;
                        row['Created_By_User_Name'] = user?.name || null;
                    }
                    const result = await upsertJsonSupplier(row, inferredCountry || row.Country, user);
                    if (result.inserted) inserted++; else if (result.updated) updated++; else errors++;
                } catch (e) {
                    console.warn('[BULK] Falha ao upsert linha:', e?.message);
                    errors++;
                }
            }
            return res.json({
                success: true,
                message: 'Bulk upload processado via banco.',
                recordsAdded: inserted,
                recordsUpdated: updated,
                errors,
                warnings,
                totalProcessed: rows.length
            });
        }

        return res.status(400).json({ success: false, message: 'Banco de dados não configurado; escrita em Excel foi descontinuada.' });
    } catch (error) {
        console.error('Error processing bulk upload:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing Excel file: ' + error.message 
        });
    }
});

// Inicializar banco de dados e servidor
async function startServer() {
    try {
        // Em produção, verificar se Google Drive está configurado
        if (NODE_ENV === 'production') {
            if (isGoogleDriveAvailable()) {
                console.log('🔄 Verificando conexão com Google Drive (não bloqueante)...');
                (async () => {
                    try {
                        await googleDriveService.refreshCache();
                        console.log('✅ Google Drive configurado com sucesso!');
                    } catch (error) {
                        console.warn('⚠️ Aviso: Erro ao conectar com Google Drive:', error.message);
                    }
                })();
            } else if (process.env.GOOGLE_DRIVE_FILE_ID) {
                console.warn('⚠️ GOOGLE_DRIVE_FILE_ID configurado, mas serviço do Google Drive não está disponível. Usando modo local.');
            } else {
                console.warn('⚠️ GOOGLE_DRIVE_FILE_ID não configurado. Usando modo local.');
            }
        }

        // Inicializar banco quando habilitado (agora não bloqueante para subir o servidor)
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            console.log('🔄 Inicializando banco de dados (JSONB)... (async, não bloqueante)');
            (async () => {
                try {
                    await initializeDatabase();
                    console.log('✅ Banco de dados inicializado.');
                } catch (error) {
                    console.warn('⚠️ [DB INIT] Falha ao inicializar banco (async):', error?.message || String(error));
                }
            })();
        } else {
            console.log('ℹ️ Banco de dados desabilitado (USE_DB/DATABASE_URL não setados)');
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 [PRODUCTION DEBUG] Servidor LOKOK rodando na porta ${PORT}`);
            console.log(`📊 [PRODUCTION DEBUG] Ambiente: ${NODE_ENV}`);
            console.log(`📊 [PRODUCTION DEBUG] Timestamp: ${new Date().toISOString()}`);
            
            if (NODE_ENV === 'production' && isGoogleDriveAvailable()) {
                console.log('📊 [PRODUCTION DEBUG] Fonte de dados: Google Drive');
                if (process.env.PUBLIC_URL) {
                    console.log('🌐 [PRODUCTION DEBUG] Public URL:', process.env.PUBLIC_URL);
                }
            }
            
            if (NODE_ENV === 'development') {
                console.log(`\n🌐 [PRODUCTION DEBUG] Acesse: http://localhost:${PORT}`);
                console.log(`📊 [PRODUCTION DEBUG] Dashboard: http://localhost:${PORT}/dashboard`);
            }
            
            console.log('\n👤 [PRODUCTION DEBUG] Usuários disponíveis:');
            console.log('Admin: admin@lokok.com / admin123');
            console.log('Gerente: manager@lokok.com / manager123');
            
            // Autenticação e gestão de usuários usam exclusivamente o banco de dados.
        });
    } catch (error) {
        console.error('❌ [PRODUCTION DEBUG] Erro ao inicializar servidor:', error);
        console.error('❌ [PRODUCTION DEBUG] Stack trace:', error.stack);
        process.exit(1);
    }
}

// Rota de status para verificar versão e ambiente
app.get('/api/status/source', (req, res) => {
  const commit = process.env.GITHUB_SHA || process.env.RAILWAY_GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || process.env.COMMIT_SHA || null;
  res.json({
    ok: true,
    env: NODE_ENV || process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    commit,
    features: { deleteRecords: true }
  });
});

// Iniciar servidor
startServer();

// Rotas de aprovação/reprovação (Admin)
app.post('/approve/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const id = req.params.id;
        const { whoWillCall, callDate } = req.body;
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }
        item.status = 'approved';
        item.approvedAt = new Date().toISOString();
        item.approvedBy = { id: req.session.user.id, name: req.session.user.name };
        item.operatorTaskPending = true;
        
        // Usar os campos definidos pelo admin na aprovação
        item.operatorAssigned = whoWillCall || 'Hubert';
        item.callDate = callDate;
        
        // Registrar histórico da aprovação
        item.history = item.history || [];
        item.history.push({
            type: 'approved',
            by: { id: req.session.user.id, name: req.session.user.name },
            operatorAssigned: item.operatorAssigned,
            callDate: item.callDate,
            timestamp: new Date().toISOString()
        });
        writeSuppliersStore(store);
        return res.json({ success: true, message: 'Approved successfully' });
    } catch (e) {
        console.error('Erro em /approve/:id', e);
        return res.status(500).json({ success: false, message: 'Internal error' });
    }
});

app.post('/reject/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const id = req.params.id;
        const { reason } = req.body || {};
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }
        item.status = 'rejected';
        item.rejectedAt = new Date().toISOString();
        item.rejectedBy = { id: req.session.user.id, name: req.session.user.name };
        item.rejectionReason = reason || '';
        item.operatorTaskPending = false;
        // Registrar histórico da reprovação
        item.history = item.history || [];
        item.history.push({
            type: 'rejected',
            by: { id: req.session.user.id, name: req.session.user.name },
            reason: item.rejectionReason,
            timestamp: new Date().toISOString()
        });
        writeSuppliersStore(store);
        return res.json({ success: true, message: 'Rejected successfully' });
    } catch (e) {
        console.error('Erro em /reject/:id', e);
        return res.status(500).json({ success: false, message: 'Internal error' });
    }
});

// Rotas para formulário do Operador
app.get('/operator-task/:id', requireAuth, requireRole(['operator', 'admin']), (req, res) => {
    try {
        const id = req.params.id;
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).render('error', { user: req.session.user, error: 'Item not found' });
        }
        return res.render('operator-task', { user: req.session.user, item });
    } catch (e) {
        console.error('Erro em GET /operator-task/:id', e);
        return res.status(500).render('error', { user: req.session.user, error: 'Internal error' });
    }
});

app.post('/operator-task/:id', requireAuth, requireRole(['operator', 'admin']), (req, res) => {
    try {
        const id = req.params.id;
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found' });
        }
        const details = {
            contactName: req.body.contactName || '',
            phoneNumber: req.body.phoneNumber || '',
            responsibleBuyer: req.body.responsibleBuyer || '',
            responsibleCaller: req.body.responsibleCaller || req.session.user?.name || '',
            dateCalled: req.body.dateCalled || '',
            result: req.body.result || '',
            followUp: req.body.followUp || '',
            whoDoYouTalk: req.body.whoDoYouTalk || '',
            comments: req.body.comments || '',
            updatedAt: new Date().toISOString(),
            updatedBy: { id: req.session.user.id, name: req.session.user.name }
        };
        item.operatorTaskPending = false;
        item.operatorDetails = details;
        item.history = item.history || [];
        item.history.push({ type: 'operator_update', data: details, timestamp: new Date().toISOString() });
        writeSuppliersStore(store);
        return res.json({ success: true, message: 'Operator task saved successfully' });
    } catch (e) {
        console.error('Erro em POST /operator-task/:id', e);
        return res.status(500).json({ success: false, message: 'Internal error' });
    }
});

// Rota para exibir histórico do distribuidor
app.get('/supplier-history/:id', requireAuth, requireRole(['admin', 'gerente', 'manager']), (req, res) => {
    try {
        const id = req.params.id;
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).render('error', { user: req.session.user, message: 'Item not found' });
        }
        const user = req.session.user;
        const isAdmin = user.role === 'admin';
        const isManager = ['gerente','manager'].includes(String(user.role || '').toLowerCase());
        const isAuthor = item.createdBy && String(item.createdBy.id) === String(user.id);
        const isResponsible = item.distributor && item.distributor['Responsable'] && item.distributor['Responsable'] === user.name;
        if (!isAdmin && !(isManager && (isAuthor || isResponsible))) {
            return res.status(403).render('error', { user: req.session.user, message: 'Access denied' });
        }
        return res.render('supplier-history', { user: req.session.user, item });
    } catch (e) {
        console.error('Erro em GET /supplier-history/:id', e);
        return res.status(500).render('error', { user: req.session.user, message: 'Internal error' });
    }
});

// Nova rota para exibir a aba de LOGs
app.get('/logs', requireAuth, async (req, res) => {
    const user = req.session.user;
    const logType = String(req.query.logType || 'all').toLowerCase();
    const userFilter = String(req.query.userFilter || '').toLowerCase();
    const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
    const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

    // Unificar formato de logs
    const unifyAccess = (l) => ({ timestamp: l.timestamp, type: 'ACCESS', user: l.username, action: l.action, details: l.userAgent, ip: l.ip });
    const unifyActivity = (l) => ({ timestamp: l.timestamp, type: 'ACTIVITY', user: l.username, action: l.action, details: l.details, ip: l.ip });

    let logs = [];
    try {
        const access = audit.getAccessLogs(500).map(unifyAccess);
        const activity = audit.getActivityLogs(500).map(unifyActivity);
        if (logType === 'access') logs = access;
        else if (logType === 'activity') logs = activity;
        else logs = [...activity, ...access].sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
        // Filtros simples (também procura no campo detalhes)
        if (userFilter) logs = logs.filter(l => {
            const u = String(l.user || '').toLowerCase();
            const d = String(l.details || '').toLowerCase();
            return u.includes(userFilter) || d.includes(userFilter);
        });
        if (startDate) logs = logs.filter(l => new Date(l.timestamp) >= startDate);
        if (endDate) logs = logs.filter(l => new Date(l.timestamp) <= endDate);
    } catch (e) {
        console.warn('Falha ao carregar logs:', e?.message || e);
        logs = [];
    }
    const debugCounts = req.session.lastSearchDebugCounts || null;

    res.render('logs', {
        user,
        logs,
        debugCounts
    });
});

// Exportar logs em CSV
app.get('/logs/export', requireAuth, (req, res) => {
    try {
        const logType = String(req.query.logType || 'all').toLowerCase();
        const userFilter = String(req.query.userFilter || '').toLowerCase();
        const startDate = req.query.startDate ? new Date(req.query.startDate) : null;
        const endDate = req.query.endDate ? new Date(req.query.endDate) : null;

        const unifyAccess = (l) => ({ timestamp: l.timestamp, type: 'ACCESS', user: l.username, action: l.action, details: l.userAgent, ip: l.ip });
        const unifyActivity = (l) => ({ timestamp: l.timestamp, type: 'ACTIVITY', user: l.username, action: l.action, details: l.details, ip: l.ip });

        let logs = [];
        const access = audit.getAccessLogs(1000).map(unifyAccess);
        const activity = audit.getActivityLogs(1000).map(unifyActivity);
        if (logType === 'access') logs = access;
        else if (logType === 'activity') logs = activity;
        else logs = [...activity, ...access].sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
        if (userFilter) logs = logs.filter(l => {
            const u = String(l.user || '').toLowerCase();
            const d = String(l.details || '').toLowerCase();
            return u.includes(userFilter) || d.includes(userFilter);
        });
        if (startDate) logs = logs.filter(l => new Date(l.timestamp) >= startDate);
        if (endDate) logs = logs.filter(l => new Date(l.timestamp) <= endDate);

        const header = 'timestamp,type,user,action,details,ip\n';
        const lines = logs.map(l => {
            const safe = (v) => String(v || '').replace(/"/g, '""');
            return `"${safe(l.timestamp)}","${safe(l.type)}","${safe(l.user)}","${safe(l.action)}","${safe(l.details)}","${safe(l.ip)}"`;
        }).join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
        return res.send(header + lines + '\n');
    } catch (e) {
        return res.status(500).json({ error: e?.message || String(e) });
    }
});

// Troca de país selecionado na sessão
app.get('/switch-country', requireAuth, (req, res) => {
    try {
        const raw = (req.query.country || '').toUpperCase();
        const allowed = normalizeAllowedCountries(req.session.user?.allowedCountries || []);
        const country = normalizeCountryCode(raw);
        if (!country) {
            return res.redirect('/dashboard');
        }
        if (!allowed.includes(country)) {
            return res.redirect('/dashboard');
        }
        req.session.selectedCountry = country;
        console.log('[PRODUCTION DEBUG] País selecionado atualizado para:', country);
        res.redirect('/dashboard');
    } catch (e) {
        console.error('Erro em /switch-country:', e);
        res.redirect('/dashboard');
    }
});

// Rota administrativa para forçar atualização do cache do Google Drive
app.get('/admin/refresh-cache', requireAuth, requireAdmin, async (req, res) => {
    try {
        if (!isGoogleDriveAvailable()) {
            console.warn('[PRODUCTION DEBUG] Tentativa de atualizar cache sem Google Drive configurado');
            return res.status(400).render('error', { user: req.session.user, message: 'Google Drive não está configurado no servidor.' });
        }
        console.log('[PRODUCTION DEBUG] Forçando atualização do cache do Google Drive...');
        await googleDriveService.refreshCache();
        console.log('[PRODUCTION DEBUG] Cache atualizado com sucesso. Redirecionando para dashboard.');
        res.redirect('/dashboard');
    } catch (e) {
        console.error('Erro em /admin/refresh-cache:', e);
        res.status(500).render('error', { user: req.session.user, message: 'Erro ao atualizar cache: ' + (e?.message || 'desconhecido') });
    }
});

// Dev-only API: counts of records for Marcelo and Jeison
// In production, requires admin. In dev/local, open for quick validation.
app.get('/api/dev/manager-counts', async (req, res) => {
  try {
    const isProd = (process.env.NODE_ENV || '').toLowerCase() === 'production';
    if (isProd) {
      if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ error: 'forbidden' });
      }
    }

    const users = await userRepository.findAllAsync();
    const marcelo = users.find(u => (u.email || '').toLowerCase() === 'marcelogalvis@mylokok.com');
    const jeison = users.find(u => (u.email || '').toLowerCase() === 'jeisonanteliz@mylokok.com');
    const managers = [marcelo, jeison].filter(Boolean);
    if (!managers.length) {
      return res.json({ managersFound: managers.length, counts: {}, total: 0 });
    }

    const allRecords = await readDbData('ALL');

    const matchesResponsible = (record, manager) => {
      const rec = record.distributor || record;
      const idMatch = rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === String(manager.id).trim();
      if (idMatch) return true;
      const name = String(manager.name || '').toLowerCase();
      const email = String(manager.email || '').toLowerCase();
      const fields = [
        rec.Responsable,
        rec.Manager,
        rec.Buyer,
        rec.Created_By_User_Name,
        rec.Created_By_User_Email,
        record.operatorAssigned,
      ].filter(Boolean).map(v => String(v).toLowerCase());
      return fields.some(v => v.includes(name) || (email && v.includes(email)));
    };

    const counts = {};
    for (const m of managers) counts[m.email] = 0;
    for (const r of allRecords) {
      for (const m of managers) {
        if (matchesResponsible(r, m)) { counts[m.email] += 1; break; }
      }
    }

    // Enrich Created_By_* for Marcelo/Jeison using strict equality on Responsable/Manager/Buyer/Email
    const enrichIfMatches = (rec, manager) => {
      const name = String(manager.name || '').trim().toLowerCase();
      const email = String(manager.email || '').trim().toLowerCase();
      const responsable = String(rec.Responsable || '').trim().toLowerCase();
      const managerField = String(rec.Manager || '').trim().toLowerCase();
      const buyerField = String(rec.Buyer || '').trim().toLowerCase();
      const contactEmail = String(rec['E-Mail'] || rec.Email || '').trim().toLowerCase();
      const hit = (responsable === name || responsable === email || managerField === name || managerField === email || buyerField === name || buyerField === email || contactEmail === email);
      if (hit) {
        rec.Created_By_User_ID = manager.id;
        rec.Created_By_User_Name = manager.name;
        rec.Created_By_User_Email = manager.email;
      }
    };
    for (const r of allRecords) {
      const rec = r.distributor || r;
      const hasCreated = rec.Created_By_User_ID || rec.Created_By_User_Name || rec.Created_By_User_Email;
      if (!hasCreated) {
        for (const m of managers) enrichIfMatches(rec, m);
      }
    }

    // Created-by counts (strict): only Created_By_User_ID/Name/Email (after enrichment)
    const createdCounts = {};
    for (const m of managers) createdCounts[m.email] = 0;
    for (const r of allRecords) {
      const rec = r.distributor || r;
      for (const m of managers) {
        const idOk = rec.Created_By_User_ID && String(rec.Created_By_User_ID).trim() === String(m.id).trim();
        const nameOk = rec.Created_By_User_Name && String(rec.Created_By_User_Name).toLowerCase().includes(String(m.name || '').toLowerCase());
        const emailOk = rec.Created_By_User_Email && String(rec.Created_By_User_Email).toLowerCase() === String(m.email || '').toLowerCase();
        if (idOk || nameOk || emailOk) { createdCounts[m.email] += 1; break; }
      }
    }

    res.json({ managersFound: managers.length, total: allRecords.length, counts, createdCounts });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
});

// Helper para baixar arquivo via URL com suporte básico a redirecionamento
async function downloadFileFromUrl(fileUrl, destPath) {
  return new Promise((resolve, reject) => {
    try {
      const doRequest = (urlToGet, redirectCount = 0) => {
        const isHttps = urlToGet.startsWith('https');
        const client = isHttps ? https : http;
        const req = client.get(urlToGet, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirectCount > 5) return reject(new Error('Too many redirects'));
            const nextUrl = res.headers.location.startsWith('http')
              ? res.headers.location
              : new URL(res.headers.location, urlToGet).toString();
            res.resume();
            return doRequest(nextUrl, redirectCount + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`Download failed with status ${res.statusCode}`));
          }
          const fileStream = fs.createWriteStream(destPath);
          res.pipe(fileStream);
          fileStream.on('finish', () => fileStream.close(() => resolve(destPath)));
          fileStream.on('error', (err) => reject(err));
        });
        req.on('error', (err) => reject(err));
      };
      doRequest(fileUrl);
    } catch (e) {
      reject(e);
    }
  });
}

// (Removidas) rotas de importação/substituição de Excel local — Drive/DB somente

// Rota admin para migrar o Excel atual para o PostgreSQL (suppliers_json)
// Útil após importar um novo arquivo via URL ou upload manual
app.get('/admin/migrate-excel-to-db', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }
    await migrateExcelToJson();
    const dedup = await deduplicateSuppliersJson();
    return res.json({ success: true, message: 'Migração concluída e duplicidades removidas.', dedup });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha na migração para o banco', error: err.message });
  }
});

// Rota admin para remover duplicidades da tabela suppliers_json
app.post('/admin/deduplicate-suppliers', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }
    const result = await deduplicateSuppliersJson();
    return res.json({ success: true, message: 'Deduplicação concluída.', result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha na deduplicação', error: err.message });
  }
});

// Variante GET para facilitar execução manual pelo navegador
app.get('/admin/deduplicate-suppliers', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }
    const result = await deduplicateSuppliersJson();
    return res.json({ success: true, message: 'Deduplicação concluída.', result });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha na deduplicação', error: err.message });
  }
});

// Rota admin para contar registros por país em suppliers_json
app.get('/admin/db-counts', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT COALESCE(country, 'UNKNOWN') AS country, COUNT(*)::int AS count
         FROM suppliers_json
         GROUP BY country
         ORDER BY count DESC`
      );
      const totalRes = await client.query(`SELECT COUNT(*)::int AS total FROM suppliers_json`);
      const total = totalRes.rows?.[0]?.total || 0;
      res.json({ success: true, total, byCountry: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Falha ao consultar contagem por país', error: err.message });
  }
});

// Busca direcionada no suppliers_json por Website/Email/Name+Country (normalizados)
app.get('/admin/find-supplier-json', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({ success: false, message: 'Banco de dados não está habilitado.' });
    }
    const websiteRaw = req.query.website || null;
    const emailRaw = req.query.email || null;
    const nameRaw = req.query.name || null;
    const countryRaw = req.query.country || null;
    const hasWebsite = !!websiteRaw;
    const hasEmail = !!emailRaw;
    const hasNameCountry = !!nameRaw && !!countryRaw;
    if (!hasWebsite && !hasEmail && !hasNameCountry) {
      return res.status(400).json({ success: false, message: 'Informe website, email ou name+country.' });
    }
    const client = await pool.connect();
    try {
      let rows;
      if (hasWebsite) {
        // Normaliza Website como nas operações de upsert
        let s = String(websiteRaw).trim().toLowerCase();
        s = s.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
        const q = `
          SELECT id, country, data, created_at
          FROM suppliers_json
          WHERE LOWER(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(COALESCE(data->>'Website', data->>'WEBSITE', data->>'URL', data->>'Site'), '^https?://', ''), '^www\.', ''), '/$', '')) = $1
          ORDER BY created_at DESC
        `;
        const resq = await client.query(q, [s]);
        rows = resq.rows;
      } else if (hasEmail) {
        const s = String(emailRaw).trim().toLowerCase();
        const q = `
          SELECT id, country, data, created_at
          FROM suppliers_json
          WHERE LOWER(COALESCE(data->>'E-Mail', data->>'Email', data->>'EMAIL')) = $1
          ORDER BY created_at DESC
        `;
        const resq = await client.query(q, [s]);
        rows = resq.rows;
      } else {
        const nm = String(nameRaw).trim().toLowerCase();
        const ct = String(countryRaw).trim().toLowerCase();
        const q = `
          SELECT id, country, data, created_at
          FROM suppliers_json
          WHERE LOWER(COALESCE(data->>'Name', data->>'Company Name', data->>'COMPANY', data->>'Empresa', data->>'Distributor')) = $1
            AND LOWER(COALESCE(country, data->>'Country', data->>'COUNTRY')) = $2
          ORDER BY created_at DESC
        `;
        const resq = await client.query(q, [nm, ct]);
        rows = resq.rows;
      }
      return res.json({ success: true, count: rows.length, results: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha na busca no suppliers_json', error: err.message });
  }
});

// Lista os últimos N registros em suppliers_json (default 5)
app.get('/admin/last-json-records', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({ success: false, message: 'Banco de dados não está habilitado.' });
    }
    const limit = Math.max(1, Math.min(50, parseInt(req.query.limit, 10) || 5));
    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT id, country, data, created_at, updated_at FROM suppliers_json ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return res.json({ success: true, limit, results: rows });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao listar últimos registros', error: err.message });
  }
});

// Rota admin de diagnóstico da fonte de dados em uso e contagem atual (US)
app.get('/admin/source-status', requireAuth, requireAdmin, async (req, res) => {
  try {
    const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof getJsonSuppliers === 'function';
    const db_active = useDb;
    const driveConfigured = isGoogleDriveAvailable();
    const selectedCountry = req.session.selectedCountry || 'US';
    const source = db_active ? 'database' : (driveConfigured ? 'googleDrive' : 'none');

    let countsUS = null;
    try {
      if (db_active) {
        const dataUS = await getJsonSuppliers(['US']);
        countsUS = Array.isArray(dataUS) ? dataUS.length : null;
      } else {
    const dataUS = await readDbData('US');
        countsUS = Array.isArray(dataUS) ? dataUS.length : null;
      }
    } catch (_) {}

    const base = {
      success: true,
      env: {
        NODE_ENV,
        USE_DB: process.env.USE_DB || null,
        DATABASE_URL_SET: !!process.env.DATABASE_URL,
        GOOGLE_DRIVE_FILE_ID_SET: !!process.env.GOOGLE_DRIVE_FILE_ID
      },
      source,
      db_active,
      selectedCountry,
      countsUS
    };

    // Incluir detalhes de Drive quando DB não está ativo
    return res.json({
      ...base,
      driveConfigured
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Falha ao consultar status da fonte', error: err.message });
  }
});

// Rota admin para atualizar o banco a partir do Excel e remover duplicidades
app.get('/admin/force-db-refresh', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }
    // Garantir que a tabela JSON existe antes de migrar
    await createJsonTable();
    await migrateExcelToJson();
    const dedup = await deduplicateSuppliersJson();
    const client = await pool.connect();
    try {
      const totalRes = await client.query('SELECT COUNT(*)::int AS total FROM suppliers_json');
      const total = totalRes.rows?.[0]?.total || 0;
      const usRes = await client.query(`SELECT COUNT(*)::int AS count FROM suppliers_json WHERE (country ILIKE 'US' OR country ILIKE 'USA' OR country ILIKE 'UNITED STATES')`);
      const usCount = usRes.rows?.[0]?.count || 0;
      return res.json({ success: true, message: 'Banco atualizado a partir do Excel e deduplicado.', total, usCount, dedup });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao atualizar banco', error: err.message });
  }
});

// Rota admin simples para criar apenas a tabela suppliers_json e verificar existência
app.get('/admin/create-suppliers-json-table', requireAuth, requireAdmin, async (req, res) => {
  try {
    if (!(process.env.USE_DB === 'true' || !!process.env.DATABASE_URL)) {
      return res.status(400).json({
        success: false,
        message: 'Banco de dados não está habilitado. Defina USE_DB=true ou configure DATABASE_URL.'
      });
    }

    // Cria a tabela se não existir
    await createJsonTable();

    // Confirma existência via to_regclass
    const client = await pool.connect();
    try {
      const existsRes = await client.query("SELECT to_regclass('public.suppliers_json') AS exists");
      const exists = existsRes.rows?.[0]?.exists || null;
      return res.json({ success: true, tableExists: !!exists, regclass: exists });
    } finally {
      client.release();
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao criar/verificar tabela', error: err.message });
  }
});

// Rota admin para exportar todos os registros em Excel (por país; padrão US)
app.get('/admin/export-excel', requireAuth, requireAdmin, async (req, res) => {
  try {
    const rawCountry = (req.query.country || 'US').toUpperCase();
    const country = rawCountry === 'ALL' ? 'ALL' : (normalizeCountryCode(rawCountry) || 'US');
    const data = await readDbData(country === 'ALL' ? 'ALL' : country);
    if (!Array.isArray(data) || data.length === 0) {
      return res.status(404).json({ success: false, message: `Nenhum registro encontrado para ${country}` });
    }

    // Cabeçalhos base + união de chaves existentes para garantir "todos os campos"
    const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
    const baseHeaders = [
      'Name','Website','CATEGORÍA','Account Request Status','DATE','Responsable',
      STATUS_HEADER,
      'Description/Notes','Contact Name','Contact Phone','E-Mail','Address','User','PASSWORD',
      'LLAMAR','PRIO (1 - TOP, 5 - bajo)','Comments','Country','Created_By_User_ID','Created_By_User_Name','Created_At'
    ];
    const union = new Set(baseHeaders);
    for (const r of data) {
      Object.keys(r || {}).forEach(k => union.add(k));
    }
    const headers = Array.from(union);

    // Montar dados em formato AoA (primeira linha cabeçalho, demais linhas valores)
    const rows = [headers];
    for (const r of data) {
      const row = headers.map(h => {
        const v = r[h];
        return v === undefined || v === null ? '' : v;
      });
      rows.push(row);
    }

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const sheetName = country === 'ALL' ? 'All Countries' : `Wholesale ${country}`;
    XLSX.utils.book_append_sheet(wb, ws, sheetName);

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `export-${country}-${timestamp}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    return res.send(buffer);
  } catch (err) {
    console.error('Erro em /admin/export-excel:', err);
    return res.status(500).json({ success: false, message: 'Falha ao exportar Excel', error: err.message });
  }
});

// Rota admin para listar endpoints disponíveis (diagnóstico rápido em produção)
app.get('/admin/health-routes', requireAuth, requireAdmin, (req, res) => {
  try {
    const routes = [];
    app._router.stack.forEach((layer) => {
      if (layer.route && layer.route.path) {
        const methods = Object.keys(layer.route.methods)
          .filter((m) => layer.route.methods[m])
          .map((m) => m.toUpperCase());
        routes.push({ path: layer.route.path, methods });
      }
    });
    res.json({ success: true, count: routes.length, routes });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Falha ao listar rotas', error: err.message });
  }
});

// RESET TOTAL DA BASE (apenas admin): zera abas preferidas do Excel e limpa suppliers.json
// (Removido) /admin/reset-base — operações locais com Excel não são mais suportadas

// Rota aberta (sem autenticação) para validar contagens no ambiente de desenvolvimento
// Usada apenas para conferência rápida quando FORCE_LOCAL_EXCEL=1
// (Removido) /api/debug-counts-open — FORCE_LOCAL_EXCEL não é mais suportado

// (Removida) rota admin de deduplicação no Excel — Excel local não suportado

// (Removida) variante aberta de deduplicação do Excel — sem suporte a Excel local

// Rota admin para persistir no Excel: tudo que estiver associado a "Nacho" passa a
// ter Created_By_* como Ignacio (ignaciocortez@mylokok.com) de forma permanente.
// (Removida) rota admin de fix para Nacho — Excel local não suportado

// Variante aberta em desenvolvimento para acionar a persistência sem autenticação
// (Removida) variante aberta de fix para Nacho — Excel local não suportado
