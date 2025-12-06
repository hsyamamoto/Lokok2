const express = require('express');
const cookieSession = require('cookie-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { User, UserRepository } = require('./models/User');
const { pool, initializeDatabase, getJsonSuppliers, insertJsonSupplier, migrateExcelToJson, deduplicateSuppliersJson, updateJsonSupplier, createJsonTable } = require('./database');
const GoogleDriveService = require('./googleDriveService');
const http = require('http');
const https = require('https');
const axios = require('axios');

const app = express();
try { fs.mkdirSync('./logs', { recursive: true }); } catch {}
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

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

// Rota de healthcheck para Railway
app.get('/health', (req, res) => {
    res.status(200).send('OK');
});

// Rota de debug para inspecionar qual Excel está sendo usado e contagem por aba
app.get('/debug/excel', (req, res) => {
    try {
        const excelPath = process.env.EXCEL_PATH || '';
        const exists = excelPath && fs.existsSync(excelPath);
        const info = {
            excelPath,
            exists,
            forceLocalExcel: process.env.FORCE_LOCAL_EXCEL,
            googleDriveFileId: process.env.GOOGLE_DRIVE_FILE_ID ? 'SET' : 'EMPTY',
        };
        if (exists) {
            const wb = XLSX.readFile(excelPath, { sheetStubs: true });
            info.sheets = wb.SheetNames;
            const counts = {};
            for (const name of wb.SheetNames) {
                try {
                    const ws = wb.Sheets[name];
                    const rows = XLSX.utils.sheet_to_json(ws);
                    counts[name] = rows.length;
                } catch (e) {
                    counts[name] = `error: ${e?.message || String(e)}`;
                }
            }
            info.counts = counts;
        }
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Diagnóstico público do Google Drive/Excel ativo
app.get('/diagnose/drive', async (req, res) => {
    try {
        const info = {
            NODE_ENV: process.env.NODE_ENV,
            GOOGLE_DRIVE_FILE_ID_SET: !!process.env.GOOGLE_DRIVE_FILE_ID,
            FORCE_LOCAL_EXCEL: process.env.FORCE_LOCAL_EXCEL,
        };

        let source = null;
        let sheetNames = [];
        let count = null;
        let firstRow = null;

        if (googleDriveService && process.env.GOOGLE_DRIVE_FILE_ID) {
            source = 'googleDrive';
            const spreadsheetPath = await googleDriveService.getSpreadsheetPath();
            info.spreadsheetPath = spreadsheetPath;
            const workbook = XLSX.readFile(spreadsheetPath);
            sheetNames = workbook.SheetNames || [];

            let rows = [];
            const preferred = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO'].filter(n => sheetNames.includes(n));
            if (preferred.length > 0) {
                for (const name of preferred) {
                    const ws = workbook.Sheets[name];
                    const part = ws ? XLSX.utils.sheet_to_json(ws) : [];
                    rows = rows.concat(part);
                }
            } else if (sheetNames.length > 0) {
                const ws = workbook.Sheets[sheetNames[0]];
                rows = ws ? XLSX.utils.sheet_to_json(ws) : [];
            }

            count = rows.length;
            firstRow = rows[0] || null;
        } else if (EXCEL_PATH) {
            source = 'localExcel';
            const workbook = XLSX.readFile(EXCEL_PATH);
            sheetNames = workbook.SheetNames || [];
            const ws = workbook.Sheets['Wholesale LOKOK'] || workbook.Sheets[sheetNames[0]];
            const rows = ws ? XLSX.utils.sheet_to_json(ws) : [];
            count = rows.length;
            firstRow = rows[0] || null;
            info.excelPath = EXCEL_PATH;
        } else {
            source = 'none';
        }

        res.json({ source, sheetNames, count, firstRow, info });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuração da planilha (local ou Google Drive)
let EXCEL_PATH;
let googleDriveService;

if (NODE_ENV === 'production' && process.env.GOOGLE_DRIVE_FILE_ID) {
    // Em produção, usar Google Drive
    console.log('🔧 [PRODUCTION DEBUG] Configurando Google Drive para produção...');
    console.log('🔧 [PRODUCTION DEBUG] GOOGLE_DRIVE_FILE_ID:', process.env.GOOGLE_DRIVE_FILE_ID ? 'SET' : 'NOT SET');
    console.log('🔧 [PRODUCTION DEBUG] GOOGLE_SERVICE_ACCOUNT_EMAIL:', process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? 'SET' : 'NOT SET');
    console.log('🔧 [PRODUCTION DEBUG] GOOGLE_PRIVATE_KEY:', process.env.GOOGLE_PRIVATE_KEY ? 'SET' : 'NOT SET');
    try {
        googleDriveService = new GoogleDriveService();
        console.log('✅ [PRODUCTION DEBUG] Google Drive Service inicializado');
        console.log('📊 Configurado para usar Google Drive em produção');
    } catch (error) {
        console.error('❌ [PRODUCTION DEBUG] Erro ao inicializar Google Drive Service:', error);
        console.error('❌ [PRODUCTION DEBUG] Stack trace:', error.stack);
    }
} else {
    // Resolver dinamicamente o caminho do Excel local
    // Suporte a planilha pública do Google: baixar para cached_spreadsheet.xlsx quando EXCEL_DOWNLOAD_URL estiver definido
    try {
        const publicExcelUrl = process.env.EXCEL_DOWNLOAD_URL;
        if (publicExcelUrl) {
            const dataDir = path.join(__dirname, 'data');
            try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
            const cachedPath = path.join(dataDir, 'cached_spreadsheet.xlsx');
            console.log('🔧 [PRODUCTION DEBUG] EXCEL_DOWNLOAD_URL detectado. Baixando planilha pública...');
            axios.get(publicExcelUrl, { responseType: 'arraybuffer' })
                .then((resp) => {
                    try {
                        fs.writeFileSync(cachedPath, resp.data);
                        EXCEL_PATH = cachedPath;
                        console.log('✅ [PRODUCTION DEBUG] Planilha pública baixada em:', cachedPath);
                    } catch (fileErr) {
                        console.warn('⚠️ [PRODUCTION DEBUG] Falha ao salvar planilha pública:', fileErr?.message);
                    }
                })
                .catch((err) => {
                    console.warn('⚠️ [PRODUCTION DEBUG] Falha ao baixar planilha pública:', err?.message);
                });
        }
    } catch (e) {
        console.warn('⚠️ [PRODUCTION DEBUG] Falha inesperada ao iniciar download da planilha pública:', e?.message);
    }

    const forceLocalExcel = process.env.FORCE_LOCAL_EXCEL === '1' || process.env.FORCE_LOCAL_EXCEL === 'true';

    // Suporte: se EXCEL_PATH for uma URL e FORCE_LOCAL_EXCEL=0, baixar para cache local
    try {
        const maybeUrl = process.env.EXCEL_PATH;
        const isHttp = typeof maybeUrl === 'string' && /^https?:\/\//i.test(maybeUrl);
        if (!forceLocalExcel && isHttp) {
            const dataDir = path.join(__dirname, 'data');
            try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
            const cachedPath = path.join(dataDir, 'cached_spreadsheet.xlsx');
            console.log('🔧 [PRODUCTION DEBUG] EXCEL_PATH é URL e FORCE_LOCAL_EXCEL=0. Baixando planilha pública via EXCEL_PATH...');
            axios.get(maybeUrl, { responseType: 'arraybuffer' })
                .then((resp) => {
                    try {
                        fs.writeFileSync(cachedPath, resp.data);
                        process.env.EXCEL_PATH = cachedPath;
                        console.log('✅ [PRODUCTION DEBUG] Planilha (EXCEL_PATH URL) baixada em:', cachedPath);
                    } catch (fileErr) {
                        console.warn('⚠️ [PRODUCTION DEBUG] Falha ao salvar cache de EXCEL_PATH:', fileErr?.message);
                    }
                })
                .catch((err) => {
                    console.warn('⚠️ [PRODUCTION DEBUG] Falha ao baixar EXCEL_PATH (URL):', err?.message);
                });
        }
    } catch (e) {
        console.warn('⚠️ [PRODUCTION DEBUG] Erro ao processar EXCEL_PATH como URL:', e?.message);
    }

    // Quando FORCE_LOCAL_EXCEL=1, priorizar estritamente EXCEL_PATH para evitar cair em bases antigas
    let candidates;
    if (forceLocalExcel) {
        candidates = [
            // Primeiro: EXCEL_PATH (obrigatório quando FORCE_LOCAL_EXCEL=1)
            process.env.EXCEL_PATH,
            // Depois: planilha oficial (1109) caso EXCEL_PATH não esteja definido
            path.join(__dirname, 'data', 'lokok2-export-US-20251119.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'lokok2-export-US-20251119.xlsx'),
            // Fallback adicional: cached_spreadsheet.xlsx incluído no repositório
            path.join(__dirname, 'data', 'cached_spreadsheet.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
            // Fallback legado: Wholesale Suppliers and Product Opportunities.xlsx
            path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx')
        ].filter(Boolean);
    } else {
        // Quando não estamos forçando arquivo local, priorize EXCEL_PATH (que pode ser URL baixada para cache)
        // e o arquivo de cache, depois caia para arquivos oficiais/legados
        candidates = [
            process.env.EXCEL_PATH,
            path.join(__dirname, 'data', 'cached_spreadsheet.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
            path.join(__dirname, 'data', 'lokok2-export-US-20251119.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'lokok2-export-US-20251119.xlsx'),
            path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
            path.join(__dirname, 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
        ].filter(Boolean);
    }

    console.log('📄 [PRODUCTION DEBUG] Candidatos para EXCEL_PATH (na ordem de prioridade):', candidates);
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                EXCEL_PATH = p;
                console.log('✅ [PRODUCTION DEBUG] Selecionado arquivo Excel:', EXCEL_PATH);
                break;
            }
        } catch (e) {
            // ignora erros de acesso
        }
    }

    if (EXCEL_PATH) {
        console.log('📊 [PRODUCTION DEBUG] Configurado para usar arquivo Excel local:', EXCEL_PATH);
    } else {
        if (forceLocalExcel && process.env.EXCEL_PATH) {
            console.error('❌ [PRODUCTION DEBUG] FORCE_LOCAL_EXCEL=1 mas o arquivo definido em EXCEL_PATH não foi encontrado:', process.env.EXCEL_PATH);
            console.error('❌ [PRODUCTION DEBUG] Verifique se o arquivo foi incluído no deploy e o caminho está correto.');
        }
        console.warn('⚠️ [PRODUCTION DEBUG] Nenhum arquivo Excel encontrado nos caminhos padrão. As buscas retornarão 0 resultados.');
    }
}

// Logs detalhados para produção
console.log('🚀 [PRODUCTION DEBUG] Iniciando servidor LOKOK2...');
console.log('🌍 [PRODUCTION DEBUG] NODE_ENV:', process.env.NODE_ENV);
console.log('📁 [PRODUCTION DEBUG] __dirname:', __dirname);
console.log('📁 [PRODUCTION DEBUG] process.cwd():', process.cwd());

// Instância do repositório de usuários
const userRepository = new UserRepository();

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

// Middleware de autorização por role
function requireRole(roles) {
    return (req, res, next) => {
        if (req.session.user && roles.includes(req.session.user.role)) {
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
    // Accept both Portuguese 'gerente' and English 'manager' (case-insensitive)
    const role = ((req.session.user && req.session.user.role) || '').toLowerCase();
    if (req.session.user && ['admin', 'gerente', 'manager'].includes(role)) {
        next();
    } else {
        res.status(403).send('Access denied');
    }
}

// Helpers de armazenamento local de distribuidores (pendências, aprovações, tarefas de operador)
const SUPPLIERS_STORE_PATH = path.join(__dirname, 'data', 'suppliers.json');
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
        'Name','Website','CATEGORÍA','Account Request Status','DATE','Responsable',
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
function enrichCreatedByForNacho(records) {
    try {
        if (!Array.isArray(records) || records.length === 0) return;
        const targetEmail = 'ignaciocortez@mylokok.com';
        const users = userRepository.findAll ? userRepository.findAll() : [];
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

// Função para ler dados da planilha
async function readExcelData(selectedCountry) {
    try {
        // Tratar seleção especial de "ALL" como todos os países
        const selectedForSource = (String(selectedCountry || '').toUpperCase() === 'ALL') ? null : selectedCountry;
        // Prefer database JSONB when enabled
        const isProd = NODE_ENV === 'production';
        // Em produção, IGNORAR FORCE_LOCAL_EXCEL para garantir leitura do banco
        const forceLocal = !isProd && process.env.FORCE_LOCAL_EXCEL === '1';
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof getJsonSuppliers === 'function' && (!forceLocal || isProd);
        if (useDb) {
            // Sem país específico -> retornar todos
            if (!selectedForSource) {
                const rows = await getJsonSuppliers();
                return rows;
            }
            const aliases = getCountryAliases(selectedForSource);
            const rows = await getJsonSuppliers(Array.isArray(aliases) ? aliases : [selectedForSource]);
            return rows;
        }
        let allData = [];
        // Determinar aba alvo com a mesma lógica usada em escrita/Google Drive
        const targetSheet = selectedForSource ? getSheetNameForCountry(selectedForSource) : null;
        
        if (NODE_ENV === 'production' && googleDriveService) {
            // Em produção, usar Google Drive
            console.log('📥 [PRODUCTION DEBUG] Carregando dados do Google Drive...');
            try {
                // Para ALL, passar undefined para ler todas as abas preferidas;
                // quando há país selecionado, o serviço já lê apenas a aba correta.
                allData = await googleDriveService.readSpreadsheetData(selectedForSource || undefined);
                console.log('✅ [PRODUCTION DEBUG] Dados carregados do Google Drive (sem filtro adicional):', allData.length, 'registros');
            } catch (driveError) {
                console.error('❌ [PRODUCTION DEBUG] Erro ao carregar do Google Drive:', driveError);
                console.log('🔄 [PRODUCTION DEBUG] Tentando fallback para arquivo local...');
                
                // Fallback para arquivo local se Google Drive falhar
                if (fs.existsSync(EXCEL_PATH)) {
                    const workbook = XLSX.readFile(EXCEL_PATH);
                    // Garantir abas de país (CA/MX) existam mesmo vazias
                    const ensured = ensureCountrySheets(workbook);
                    const shouldPersistEnsure = /cached_spreadsheet\.xlsx$/i.test(EXCEL_PATH || '');
                    if (ensured.changed && shouldPersistEnsure) {
                        try { XLSX.writeFile(workbook, EXCEL_PATH); } catch (_) {}
                    }
                    const sheetNames = workbook.SheetNames || [];
                    console.log('[PRODUCTION DEBUG] Fallback - Excel carregado:', EXCEL_PATH, 'Sheets:', sheetNames);
                    
                    const preferredSheets = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO'];
                    const existingPreferred = preferredSheets.filter(name => sheetNames.includes(name));
                    
                    if (selectedForSource) {
                        const resolved = findSheetNameForCountryCaseInsensitive(sheetNames, selectedForSource) || targetSheet;
                        if (resolved && sheetNames.includes(resolved)) {
                            console.log('[PRODUCTION DEBUG] Lendo aba específica para país selecionado (resolvida):', resolved);
                            const ws = workbook.Sheets[resolved];
                            const rows = XLSX.utils.sheet_to_json(ws);
                            allData = allData.concat(rows);
                        } else if (existingPreferred.length > 0) {
                            for (const name of existingPreferred) {
                                const ws = workbook.Sheets[name];
                                const rows = XLSX.utils.sheet_to_json(ws);
                                allData = allData.concat(rows);
                            }
                        } else {
                            for (const name of sheetNames) {
                                try {
                                    const ws = workbook.Sheets[name];
                                    const rows = XLSX.utils.sheet_to_json(ws);
                                    allData = allData.concat(rows);
                                } catch (e) {
                                    console.warn('[PRODUCTION DEBUG] Falha ao ler aba:', name, e?.message);
                                }
                            }
                        }
                    } else if (existingPreferred.length > 0) {
                        for (const name of existingPreferred) {
                            const ws = workbook.Sheets[name];
                            const rows = XLSX.utils.sheet_to_json(ws);
                            allData = allData.concat(rows);
                        }
                    } else {
                        for (const name of sheetNames) {
                            try {
                                const ws = workbook.Sheets[name];
                                const rows = XLSX.utils.sheet_to_json(ws);
                                allData = allData.concat(rows);
                            } catch (e) {
                                console.warn('[PRODUCTION DEBUG] Falha ao ler aba:', name, e?.message);
                            }
                        }
                    }
                } else {
                    console.error('❌ [PRODUCTION DEBUG] Arquivo Excel local não encontrado:', EXCEL_PATH);
                    throw new Error('Nenhuma fonte de dados disponível');
                }
            }
        } else {
            // Em desenvolvimento, usar arquivo local
            if (!fs.existsSync(EXCEL_PATH)) {
                console.error('❌ [PRODUCTION DEBUG] Arquivo Excel não encontrado:', EXCEL_PATH);
                throw new Error(`Arquivo Excel não encontrado: ${EXCEL_PATH}`);
            }
            
            const workbook = XLSX.readFile(EXCEL_PATH);
            // Garantir abas de país (CA/MX) existam mesmo vazias
            const ensured = ensureCountrySheets(workbook);
            const shouldPersistEnsure = /cached_spreadsheet\.xlsx$/i.test(EXCEL_PATH || '');
            if (ensured.changed && shouldPersistEnsure) {
                try { XLSX.writeFile(workbook, EXCEL_PATH); } catch (_) {}
            }
            const sheetNames = workbook.SheetNames || [];
            console.log('[PRODUCTION DEBUG] Excel carregado:', EXCEL_PATH, 'Sheets:', sheetNames);

            // Preferir abas específicas se existirem; caso contrário, ler todas as abas
            const preferredSheets = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO'];
            const existingPreferred = preferredSheets.filter(name => sheetNames.includes(name));

            if (selectedForSource) {
                // Resolver aba por país com tolerância à capitalização
                const effectiveTarget = findSheetNameForCountryCaseInsensitive(sheetNames, selectedForSource) || getSheetNameForCountry(selectedForSource);
                if (effectiveTarget && sheetNames.includes(effectiveTarget)) {
                    const ws = workbook.Sheets[effectiveTarget];
                    const rows = XLSX.utils.sheet_to_json(ws);
                    console.log('[PRODUCTION DEBUG] Lendo aba por país (sem filtro por Country):', selectedForSource, '→', effectiveTarget, 'Registros:', rows.length);
                    // Não aplicar filtro por Country; contar por aba específica
                    allData = allData.concat(rows);
                    // Caso Canadá, também incluir outras abas relacionadas (ex.: SEARCHING FILE CANADA)
                    if (String(selectedForSource).toUpperCase() === 'CA') {
                        const extraCanadaSheets = ['SEARCHING FILE CANADA'];
                        for (const extra of extraCanadaSheets) {
                            if (sheetNames.includes(extra)) {
                                try {
                                    const wsExtra = workbook.Sheets[extra];
                                    const rowsExtra = XLSX.utils.sheet_to_json(wsExtra);
                                    console.log('[PRODUCTION DEBUG] Lendo aba extra de Canadá:', extra, 'Registros:', rowsExtra.length);
                                    allData = allData.concat(rowsExtra);
                                } catch (e) {
                                    console.warn('[PRODUCTION DEBUG] Falha ao ler aba extra de Canadá:', extra, e?.message);
                                }
                            }
                        }
                    }
                } else {
                    console.warn('[PRODUCTION DEBUG] Aba para país não encontrada, retornando vazio:', selectedForSource, 'targetSheet:', targetSheet);
                }
            } else if (!selectedForSource && existingPreferred.length > 0) {
                // Sem país selecionado (ALL): concatenar abas preferidas SEM filtrar por Country
                for (const name of existingPreferred) {
                    const ws = workbook.Sheets[name];
                    const rows = XLSX.utils.sheet_to_json(ws);
                    console.log('[PRODUCTION DEBUG] Lendo aba preferida (ALL sem filtro):', name, 'Registros:', rows.length);
                    allData = allData.concat(rows);
                }
            } else {
                console.warn('[PRODUCTION DEBUG] Nenhuma aba preferida encontrada. Lendo todas as abas do arquivo.');
                for (const name of sheetNames) {
                    try {
                        const ws = workbook.Sheets[name];
                        const rows = XLSX.utils.sheet_to_json(ws);
                        console.log('[PRODUCTION DEBUG] Lendo aba:', name, 'Registros:', rows.length);
                        allData = allData.concat(rows);
                    } catch (e) {
                        console.warn('[PRODUCTION DEBUG] Falha ao ler aba:', name, e?.message);
                    }
                }
                console.log('[PRODUCTION DEBUG] Total de registros após ler todas as abas:', allData.length);
            }
        }
        
        // Normalizar chaves para compatibilidade com a UI
        const normalizedData = Array.isArray(allData) ? allData.map(normalizeRecordKeys) : [];
        console.log(`✅ [PRODUCTION DEBUG] Dados carregados: ${normalizedData.length} registros`);
        if (normalizedData.length > 0) {
            console.log('[PRODUCTION DEBUG] Primeiro registro (normalizado):', JSON.stringify(normalizedData[0]));
        }
        return normalizedData;
    } catch (error) {
        console.error('❌ [PRODUCTION DEBUG] Error reading spreadsheet:', error);
        console.error('❌ [PRODUCTION DEBUG] Stack trace:', error.stack);
        return [];
    }
}

// Função para escrever dados na planilha
async function writeExcelData(data, selectedCountry) {
    try {
        if (NODE_ENV === 'production' && googleDriveService) {
            // Em produção, salvar no Google Drive
            console.log('💾 Salvando dados no Google Drive (aba por país)...');
            await googleDriveService.saveSpreadsheetData(data, selectedCountry);
        } else {
            // Em desenvolvimento, salvar no arquivo local
            const workbook = XLSX.readFile(EXCEL_PATH);
            const targetSheet = getSheetNameForCountry(selectedCountry);
            // Garantir que a aba alvo exista
            const ensured = ensureCountrySheets(workbook);
            if (ensured.changed) {
                console.log('🔧 Abas de país garantidas antes de salvar');
            }
            const worksheet = XLSX.utils.json_to_sheet(data);
            workbook.Sheets[targetSheet] = worksheet;
            if (!workbook.SheetNames.includes(targetSheet)) {
                workbook.SheetNames.push(targetSheet);
            }
            XLSX.writeFile(workbook, EXCEL_PATH);
        }
        console.log('✅ Dados salvos com sucesso');
        return true;
    } catch (error) {
        console.error('❌ Erro ao salvar dados:', error);
        return false;
    }
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

app.post('/login', (req, res) => {
    const { email, password } = req.body;
    console.log('[PRODUCTION DEBUG] Tentativa de login para:', email);
    console.log('[PRODUCTION DEBUG] IP do cliente:', req.ip);
    console.log('[PRODUCTION DEBUG] User-Agent:', req.get('User-Agent'));
    console.log('[PRODUCTION DEBUG] Password length:', password?.length);
    
    const user = userRepository.findByEmail(email);
    console.log('[PRODUCTION DEBUG] Usuário encontrado:', user ? { id: user.id, email: user.email, role: user.role } : 'null');
    
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

// Rota principal - Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
    console.log('[PRODUCTION DEBUG] Acessando dashboard para usuário:', req.session.user?.email);
    console.log('[PRODUCTION DEBUG] Role do usuário:', req.session.user?.role);
    console.log('[PRODUCTION DEBUG] Session ID:', req.sessionID);
    console.log('[PRODUCTION DEBUG] IP do cliente:', req.ip);
    
    try {
        console.log('[PRODUCTION DEBUG] Carregando dados para o dashboard...');
        console.log('[PRODUCTION DEBUG] Ambiente:', NODE_ENV);
        console.log('[PRODUCTION DEBUG] Google Drive Service disponível:', !!googleDriveService);
        
        const allowedCountries = normalizeAllowedCountries(req.session.user?.allowedCountries);
        const selectedCountry = req.session.selectedCountry || (allowedCountries[0] || 'US');
        const data = await readExcelData(selectedCountry);
        // Mapear tudo que estiver como “Nacho” para Ignacio como criador
        enrichCreatedByForNacho(data);
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

    const stats = {
        totalRecords: filteredData.length,
        categoryStats,
        responsibleStats,
        monthlyStats
    };
    // Ler pendências de aprovação
    const suppliersStore = readSuppliersStore();
    const pendingApprovals = suppliersStore.filter(item => item.status === 'pending_approval');
    const operatorTasks = suppliersStore.filter(item => item.status === 'approved' && item.operatorTaskPending === true);
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
    const allUsers = userRepository.findAll();
    
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

app.get('/form', requireAuth, requireManagerOrAdmin, (req, res) => {
    const managers = userRepository.findAll().filter(u => (u.role === 'gerente' || u.role === 'manager'));
    const managersList = managers.map(u => ({ id: u.id, name: u.name, email: u.email }));
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    res.render('form', { user: req.session.user, managersList, selectedCountry });
});

app.get('/bulk-upload', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('bulk-upload', { user: req.session.user });
});

// Rota de debug para verificar contagens por país diretamente do backend
app.get('/api/debug-counts', requireAuth, async (req, res) => {
    try {
        const allowedCountries = normalizeAllowedCountries(req.session.user?.allowedCountries);
        const selectedCountry = req.session.selectedCountry || (allowedCountries[0] || 'US');
        const us = await readExcelData('US');
        const ca = await readExcelData('CA');
        const mx = await readExcelData('MX');
        const cn = await readExcelData('CN');
        const allCount = us.length + ca.length + mx.length + cn.length;
        // Diagnóstico detalhado por aba e distribuição de Country
        let excelInfo = null;
        try {
            if (fs.existsSync(EXCEL_PATH)) {
                const wb = XLSX.readFile(EXCEL_PATH);
                const sheetNames = wb.SheetNames || [];
                const preferred = ['Wholesale LOKOK','Wholesale CANADA','Wholesale MEXICO','Wholesale CHINA'];
                const existingPreferred = preferred.filter(n => sheetNames.includes(n));
                const perSheetCounts = {};
                const countryHistogram = {};
                for (const name of sheetNames) {
                    try {
                        const ws = wb.Sheets[name];
                        const rows = XLSX.utils.sheet_to_json(ws);
                        perSheetCounts[name] = rows.length;
                        // Histograma de Country (limitado para depuração)
                        const hist = {};
                        for (const r of rows) {
                            const c = r.Country || r.PAIS || r.País || r['COUNTRY'] || '';
                            const key = String(c || '').trim().toUpperCase() || '(BLANK)';
                            hist[key] = (hist[key] || 0) + 1;
                        }
                        // ordenar chaves por contagem desc e limitar a 10
                        const sorted = Object.entries(hist).sort((a,b) => b[1]-a[1]).slice(0, 10);
                        countryHistogram[name] = Object.fromEntries(sorted);
                    } catch (_) {}
                }
                // Filtragem específica: US na aba LOKOK (antes/depois)
                let usFromLokokUnfiltered = null;
                let usFromLokokFiltered = null;
                if (sheetNames.includes('Wholesale LOKOK')) {
                    const ws = wb.Sheets['Wholesale LOKOK'];
                    const rows = XLSX.utils.sheet_to_json(ws);
                    usFromLokokUnfiltered = rows.length;
                    const aliases = getCountryAliases('US');
                    const filtered = rows.filter(r => {
                        const c = r.Country || r.PAIS || r.País || r['COUNTRY'];
                        const cu = c ? String(c).toUpperCase() : '';
                        return c ? aliases.some(a => cu.includes(a)) : false;
                    });
                    usFromLokokFiltered = filtered.length;
                }
                excelInfo = {
                    excelPath: EXCEL_PATH,
                    sheetNames,
                    existingPreferred,
                    perSheetCounts,
                    countryHistogram,
                    usFromLokokUnfiltered,
                    usFromLokokFiltered,
                };
            }
        } catch (excelErr) {
            excelInfo = { error: excelErr?.message || String(excelErr) };
        }

            res.json({
                selectedCountry,
                counts: {
                    US: us.length,
                    CA: ca.length,
                    MX: mx.length,
                    CN: cn.length
                },
                excelInfo
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

// Health-check simples (sem autenticação) para validar servidor/porta
app.get('/healthz', (req, res) => {
    try {
        const info = {
            ok: true,
            port: PORT,
            env: NODE_ENV,
            timestamp: new Date().toISOString()
        };
        res.json(info);
    } catch (e) {
        res.status(500).json({ ok: false, error: e?.message });
    }
});

app.post('/add-record', requireAuth, requireManagerOrAdmin, async (req, res) => {
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readExcelData(selectedCountry);
    const allData = await readExcelData('ALL');
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
        'Account Request Status': req.body.accountStatus,
        'DATE': req.body.date,
        // Default Responsable to current user's name if not provided
        'Responsable': req.body.responsable || (req.session.user?.name || ''),
        'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)': req.body.status,
        'Description/Notes': req.body.description,
        'Contact Name': req.body.contactName,
        'Contact Phone': req.body.phone,
        'E-Mail': req.body.email,
        'Address': req.body.address,
        'User': req.body.user,
        'PASSWORD': req.body.password,
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
    const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof insertJsonSupplier === 'function';
    if (useDb) {
        // Persist directly to DB JSONB table
        saved = await insertJsonSupplier(newRecord, selectedCountry, req.session.user);
    } else {
        // Fallback to Excel/Drive persistence
        data.push(newRecord);
        saved = await writeExcelData(data, selectedCountry);
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
    
    const pathUsed = useDb ? 'database' : (googleDriveService ? 'googleDrive' : 'localExcel');
    if (saved) {
        res.json({ success: true, message: 'Record added successfully!', debug: { path: pathUsed, country: selectedCountry } });
    } else {
        res.json({ success: false, message: 'Error adding record.', debug: { path: pathUsed, country: selectedCountry } });
    }
});

// Rota para gerenciar usuários (apenas admin)
app.get('/users', requireAuth, requireAdmin, (req, res) => {
    const users = userRepository.findAll();
    res.render('users', { 
        users: users,
        currentUser: req.session.user
    });
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
        if (userRepository.emailExists(email)) {
            return res.json({ success: false, message: 'Email is already in use' });
        }
        
        // Criar novo usuário
        const newUser = userRepository.create({
            name,
            email,
            password,
            role,
            createdBy: req.session.user.id,
            allowedCountries: allowedCountries
        });
        
        res.json({ success: true, user: newUser });
    } catch (error) {
        console.error('Error creating user:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

// API para editar usuário
app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
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
        const existingUser = userRepository.findByEmail(email);
        if (existingUser && existingUser.id !== userId) {
            return res.json({ success: false, message: 'This email is already in use by another user' });
        }
        
        // Atualizar usuário
        const updatedUser = userRepository.update(userId, {
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
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUserId = req.session.user.id;
        
        // Não permitir que admin delete a si mesmo
        if (userId === currentUserId) {
            return res.json({ success: false, message: 'You cannot delete your own account' });
        }
        
        const success = userRepository.delete(userId);
        
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

// Rota de busca
app.get('/search', requireAuth, async (req, res) => {
    const { query, type } = req.query;
    // Garantir que buscas respeitem o país selecionado na sessão
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    let data = await readExcelData(selectedCountry);
    
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
            const arr = await readExcelData(cc);
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
        const countryCode = normalizeCountryCode(countryRaw) || 'US';
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
        const managers = (userRepository && Array.isArray(userRepository.users))
            ? userRepository.users.filter(u => (u.role === 'gerente' || u.role === 'manager') && !!u.isActive)
            : [];
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
    if (req.session.user.role === 'gerente') {
        // Não filtrar os dados, mas marcar quais são do usuário para controle de exibição
        const userName = (req.session.user.name || '').toLowerCase();
        const userEmail = (req.session.user.email || '').toLowerCase();
        const userId = req.session.user.id;
        data = data.map(record => {
            const responsibleRaw = getField(record, ['Responsable','Manager','Buyer']);
            const responsible = ((responsibleRaw || '') + '').toLowerCase();
            const createdById = Number(record['Created_By_User_ID'] || record.Created_By_User_ID || 0);
            const createdByName = ((record['Created_By_User_Name'] || record.Created_By_User_Name || '') + '').toLowerCase();
            const isResponsible = (
                (responsible.includes(userName) || responsible.includes(userEmail)) ||
                (!!userId && createdById === Number(userId)) ||
                (createdByName && createdByName.includes(userName))
            );
            return {
                ...record,
                _isResponsible: !!isResponsible
            };
        });
    } else if (req.session.user.role !== 'admin') {
        // Para outros usuários não-admin:
        // Sempre permitir visualizar todos os registros, marcando _isResponsible para controle de exibição
        const userName = (req.session.user.name || '').toLowerCase();
        const userEmail = (req.session.user.email || '').toLowerCase();
        const userId = req.session.user.id;
        data = data.map(record => {
            const responsibleRaw = getField(record, ['Responsable','Manager','Buyer']);
            const responsible = ((responsibleRaw || '') + '').toLowerCase();
            const createdById = Number(record['Created_By_User_ID'] || record.Created_By_User_ID || 0);
            const createdByName = ((record['Created_By_User_Name'] || record.Created_By_User_Name || '') + '').toLowerCase();
            const isResponsible = (
                (responsible.includes(userName) || responsible.includes(userEmail)) ||
                (!!userId && createdById === Number(userId)) ||
                (createdByName && createdByName.includes(userName))
            );
            return {
                ...record,
                _isResponsible: !!isResponsible
            };
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
                resultsAdvanced = resultsAdvanced.filter(record => (((getField(record, [fieldStatusName]) || '') + '').trim().length === 0));
                console.log('[SEARCH DEBUG] status blank filter applied. before:', before, 'after:', resultsAdvanced.length);
            } else {
                const term = normalize(status);
                resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, [fieldStatusName])) === term);
                console.log('[SEARCH DEBUG] status filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
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
            status: ['STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)'],
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
    // Lista dinâmica de STATUS geral (coleta todos os valores existentes no dataset)
    const statusList = collectUniqueValues(data, [fieldStatusName]);
    
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
    const data = await readExcelData(selectedCountry);
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
    
    // Verificar permissões: admin pode editar tudo, gerente só pode editar se for responsável
    if (user.role !== 'admin') {
        if (user.role !== 'gerente') {
            return res.status(403).render('error', { 
                message: 'Access denied. Only administrators and managers can edit records.',
                user: user
            });
        }
        
        // Verificar se o gerente é responsável pelo registro
        const responsaveis = record.Responsable ? record.Responsable.split(',').map(r => r.trim()) : [];
        if (!responsaveis.includes(user.name)) {
            return res.status(403).render('error', { 
                message: 'Access denied. You can only edit distributors you are responsible for.',
                user: user
            });
        }
    }
    
    res.render('edit', { 
        record: record,
        recordId: recordId,
        user: user
    });
});

// Rota POST para processar alterações
app.post('/edit/:id', requireAuth, async (req, res) => {
    const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readExcelData(selectedCountry);
    const allData = await readExcelData('ALL');
    const recordId = parseInt(req.params.id);
    const user = req.session.user;
    
    // Verificar se o registro existe
    if (recordId < 0 || recordId >= data.length) {
        return res.status(404).json({ success: false, message: 'Record not found' });
    }
    
    const record = data[recordId];
    
    // Verificar permissões novamente
    if (user.role !== 'admin') {
        if (user.role !== 'gerente') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Only administrators and managers can edit records.' 
            });
        }
        
        const responsaveis = record.Responsable ? record.Responsable.split(',').map(r => r.trim()) : [];
        const allowedCountries = Array.isArray(user.allowedCountries) ? user.allowedCountries.map(c => String(c).toUpperCase()) : [];
        const isAllowedCountry = allowedCountries.includes(String(selectedCountry).toUpperCase());
        const canEditByResponsable = responsaveis.length === 0 || responsaveis.includes(user.name);
        if (!canEditByResponsable && !isAllowedCountry) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. You can only edit distributors you are responsible for or within your allowed countries.' 
            });
        }
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
        accountRequestStatus,
        status,
        generalStatus,
        responsable,
        contactName,
        contactEmail,
        contactPhone,
        address,
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
    if (accountRequestStatus !== undefined) data[recordId]['Account Request Status'] = accountRequestStatus;
    // Atualizar o STATUS geral no cabeçalho oficial da planilha
    const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
    if (status !== undefined) data[recordId][STATUS_HEADER] = status;
    // Manter compatibilidade com possíveis campos antigos
    if (generalStatus !== undefined) data[recordId]['General Status'] = generalStatus;
    if (responsable !== undefined) data[recordId].Responsable = responsable;
    if (contactName !== undefined) data[recordId]['Contact Name'] = contactName;
    if (contactEmail !== undefined) {
        // Atualizar ambos cabeçalhos usados no sistema
        data[recordId]['Contact Email'] = contactEmail;
        data[recordId]['E-Mail'] = contactEmail;
    }
    if (contactPhone !== undefined) data[recordId]['Contact Phone'] = contactPhone;
    if (address !== undefined) data[recordId].Address = address;
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
    const forceLocal = process.env.FORCE_LOCAL_EXCEL === '1';
    const canUseDb = !forceLocal && (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof updateJsonSupplier === 'function';
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
        saveSuccess = await writeExcelData(data, selectedCountry);
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
    try {
        const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
        const data = await readExcelData(selectedCountry);
        const recordId = parseInt(req.params.id);
        const user = req.session.user;

        if (Number.isNaN(recordId) || recordId < 0 || recordId >= data.length) {
            return res.status(404).json({ success: false, message: 'Record not found' });
        }

        const record = data[recordId];

        // Permissões: admin pode deletar qualquer registro; gerente só se for responsável
        if (user.role !== 'admin') {
            if (user.role !== 'gerente') {
                return res.status(403).json({ success: false, message: 'Access denied. Only administrators and managers can delete records.' });
            }
            const responsaveis = record.Responsable ? record.Responsable.split(',').map(r => r.trim()) : [];
            if (!responsaveis.includes(user.name)) {
                return res.status(403).json({ success: false, message: 'Access denied. You can only delete distributors you are responsible for.' });
            }
        }

        // Persistência: prioriza DB quando habilitado; quando DB está ativo, NÃO fazer fallback para Excel
        const isProd = NODE_ENV === 'production';
        const forceLocal = !isProd && process.env.FORCE_LOCAL_EXCEL === '1';
        const canUseDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof require('./database').deleteJsonSupplier === 'function' && (!forceLocal || isProd);
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

// Rota para download do template Excel
app.get('/download-template', requireAuth, requireManagerOrAdmin, (req, res) => {
    try {
        const wb = XLSX.utils.book_new();

        // Cabeçalhos alinhados com o formulário e planilha
        const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
        const templateData = [
            {
                'Name': 'Example Company Ltd',
                'Website': 'https://example.com',
                'CATEGORÍA': 'Electronics',
                'Account Request Status': 'REQUESTED',
                'DATE': '2024-01-15',
                'Responsable': 'John Doe',
                [STATUS_HEADER]: 'PENDING APPROVAL',
                'Description/Notes': 'Example supplier description',
                'Contact Name': 'Jane Smith',
                'Contact Phone': '+1-555-0123',
                'E-Mail': 'jane@example.com',
                'Address': '123 Business St',
                'User': 'registered_user',
                'PASSWORD': 'secret',
                'LLAMAR': 'YES',
                'PRIO (1 - TOP, 5 - bajo)': 'High',
                'Comments': 'Additional notes',
                'Country': 'US'
            }
        ];

        const ws = XLSX.utils.json_to_sheet(templateData);

        // Larguras de colunas otimizadas
        const colWidths = [
            { wch: 28 }, // Name
            { wch: 30 }, // Website
            { wch: 18 }, // CATEGORÍA
            { wch: 20 }, // Account Request Status
            { wch: 12 }, // DATE
            { wch: 20 }, // Responsable
            { wch: 40 }, // STATUS (...)
            { wch: 32 }, // Description/Notes
            { wch: 22 }, // Contact Name
            { wch: 18 }, // Contact Phone
            { wch: 26 }, // E-Mail
            { wch: 28 }, // Address
            { wch: 20 }, // User
            { wch: 18 }, // PASSWORD
            { wch: 12 }, // LLAMAR
            { wch: 20 }, // PRIO (1 - TOP, 5 - bajo)
            { wch: 30 }, // Comments
            { wch: 10 }  // Country
        ];
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Suppliers Template');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        res.setHeader('Content-Disposition', 'attachment; filename="suppliers_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.send(buffer);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ success: false, message: 'Error generating template file' });
    }
});

// Rota para upload em lote de fornecedores (DB-first; fallback para Excel somente quando DB inativo)
app.post('/bulk-upload', requireAuth, requireManagerOrAdmin, upload.single('excelFile'), async (req, res) => {
    try {
        const user = req.session.user;
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
        }
        const buffer = file.buffer;
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const forceLocal = process.env.FORCE_LOCAL_EXCEL === '1';
        const canUseDb = !forceLocal && (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);

        if (canUseDb) {
            let inserted = 0, updated = 0, errors = 0;
            // Inferir país a partir do sheet name
            const normalized = String(sheetName || '').trim().toLowerCase();
            let inferredCountry = null;
            if (normalized.includes('lokok') || normalized.includes('usa') || normalized.includes('united states')) inferredCountry = 'US';
            else if (normalized.includes('canada')) inferredCountry = 'CA';
            else if (normalized.includes('mexico')) inferredCountry = 'MX';
            else if (normalized.includes('china')) inferredCountry = 'CN';

            for (const row of rows) {
                try {
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
            return res.json({ success: true, message: 'Bulk upload processado via banco.', summary: { inserted, updated, errors, total: rows.length } });
        }

        // Fallback: lógica existente para Excel
        const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || 'US';
        const existing = await readExcelData(selectedCountry);
        const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
        // Mesclar mantendo cabeçalhos e evitar duplicidades por Website
        const normalizeWebsite = (w) => {
            if (!w) return '';
            let s = String(w).trim().toLowerCase();
            s = s.replace(/^https?:\/\//, '');
            s = s.replace(/^www\./, '');
            s = s.replace(/\/$/, '');
            return s;
        };
        const getWebsite = (rec) => {
            if (!rec) return '';
            const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
                || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
            return candidate || '';
        };
        const seen = new Set(existing.map(r => normalizeWebsite(getWebsite(r))));
        const merged = existing.slice();
        let added = 0;
        for (const row of rows) {
            const key = normalizeWebsite(getWebsite(row));
            if (key && seen.has(key)) continue;
            seen.add(key);
            // Assegurar headers importantes
            if (row['Account Request Status'] === undefined) row['Account Request Status'] = '';
            if (row[STATUS_HEADER] === undefined) row[STATUS_HEADER] = row['General Status'] || '';
            row.Country = row.Country || selectedCountry;
            merged.push(row);
            added++;
        }
        const ok = await writeExcelData(merged, selectedCountry);
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Erro ao salvar no Excel durante bulk-upload.' });
        }
        return res.json({ success: true, message: 'Bulk upload processado no Excel.', summary: { added, total: rows.length } });
    } catch (error) {
        console.error('Error processing bulk upload:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing Excel file: ' + error.message 
        });
    }
});

// Atualizar bulk-upload para usar DB como fonte principal quando habilitado
app.post('/bulk-upload', requireAuth, requireManagerOrAdmin, async (req, res) => {
    try {
        const user = req.session.user;
        const file = req.files?.excelFile;
        if (!file) {
            return res.status(400).json({ success: false, message: 'Nenhum arquivo enviado.' });
        }
        const buffer = file.data;
        const workbook = XLSX.read(buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        const forceLocal = process.env.FORCE_LOCAL_EXCEL === '1';
        const canUseDb = !forceLocal && (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);

        if (canUseDb) {
            const { upsertJsonSupplier } = require('./database');
            let inserted = 0, updated = 0, errors = 0;
            // Inferir país a partir do sheet name
            const normalized = String(sheetName || '').trim().toLowerCase();
            let inferredCountry = null;
            if (normalized.includes('lokok') || normalized.includes('usa') || normalized.includes('united states')) inferredCountry = 'US';
            else if (normalized.includes('canada')) inferredCountry = 'CA';
            else if (normalized.includes('mexico')) inferredCountry = 'MX';
            else if (normalized.includes('china')) inferredCountry = 'CN';

            for (const row of rows) {
                try {
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
            return res.json({ success: true, message: 'Bulk upload processado via banco.', summary: { inserted, updated, errors, total: rows.length } });
        }

        // Fallback: lógica existente para Excel
        const selectedCountry = (req.query.country && req.query.country.toUpperCase()) || req.session.selectedCountry || 'US';
        const existing = await readExcelData(selectedCountry);
        const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
        // Mesclar mantendo cabeçalhos e evitar duplicidades por Website
        const normalizeWebsite = (w) => {
            if (!w) return '';
            let s = String(w).trim().toLowerCase();
            s = s.replace(/^https?:\/\//, '');
            s = s.replace(/^www\./, '');
            s = s.replace(/\/$/, '');
            return s;
        };
        const getWebsite = (rec) => {
            if (!rec) return '';
            const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
                || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
            return candidate || '';
        };
        const seen = new Set(existing.map(r => normalizeWebsite(getWebsite(r))));
        const merged = existing.slice();
        let added = 0;
        for (const row of rows) {
            const key = normalizeWebsite(getWebsite(row));
            if (key && seen.has(key)) continue;
            seen.add(key);
            // Assegurar headers importantes
            if (row['Account Request Status'] === undefined) row['Account Request Status'] = '';
            if (row[STATUS_HEADER] === undefined) row[STATUS_HEADER] = row['General Status'] || '';
            row.Country = row.Country || selectedCountry;
            merged.push(row);
            added++;
        }
        const ok = await writeExcelData(merged, selectedCountry);
        if (!ok) {
            return res.status(500).json({ success: false, message: 'Erro ao salvar no Excel durante bulk-upload.' });
        }
        return res.json({ success: true, message: 'Bulk upload processado no Excel.', summary: { added, total: rows.length } });
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
            if (process.env.GOOGLE_DRIVE_FILE_ID) {
                console.log('🔄 Verificando conexão com Google Drive (não bloqueante)...');
                (async () => {
                    try {
                        await googleDriveService.refreshCache();
                        console.log('✅ Google Drive configurado com sucesso!');
                    } catch (error) {
                        console.warn('⚠️ Aviso: Erro ao conectar com Google Drive:', error.message);
                    }
                })();
            } else {
                console.warn('⚠️ GOOGLE_DRIVE_FILE_ID não configurado. Usando modo local.');
            }
        }

        // Inicializar banco quando habilitado
        const forceLocal = process.env.FORCE_LOCAL_EXCEL === '1';
        const useDb = !forceLocal && (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            console.log('🔄 Inicializando banco de dados (JSONB)...');
            await initializeDatabase();
            console.log('✅ Banco de dados inicializado.');
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 [PRODUCTION DEBUG] Servidor LOKOK rodando na porta ${PORT}`);
            console.log(`📊 [PRODUCTION DEBUG] Ambiente: ${NODE_ENV}`);
            console.log(`📊 [PRODUCTION DEBUG] Timestamp: ${new Date().toISOString()}`);
            
            if (NODE_ENV === 'production' && googleDriveService) {
                console.log('📊 [PRODUCTION DEBUG] Fonte de dados: Google Drive');
                console.log('🌐 [PRODUCTION DEBUG] URL de produção: https://lokok2-production.up.railway.app');
            } else {
                console.log('📊 [PRODUCTION DEBUG] Fonte de dados: Arquivo Excel local');
            }
            
            if (NODE_ENV === 'development') {
                console.log(`\n🌐 [PRODUCTION DEBUG] Acesse: http://localhost:${PORT}`);
                console.log(`📊 [PRODUCTION DEBUG] Dashboard: http://localhost:${PORT}/dashboard`);
            }
            
            console.log('\n👤 [PRODUCTION DEBUG] Usuários disponíveis:');
            console.log('Admin: admin@lokok.com / admin123');
            console.log('Gerente: manager@lokok.com / manager123');
            
            // Verificar se users.json existe
            const usersPath = path.join(__dirname, 'data', 'users.json');
            console.log(`📁 [PRODUCTION DEBUG] Verificando users.json em: ${usersPath}`);
            
            try {
                if (fs.existsSync(usersPath)) {
                    const usersData = fs.readFileSync(usersPath, 'utf8');
                    let parsed = JSON.parse(usersData);
                    const usersArr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.users) ? parsed.users : []);
                    console.log(`✅ [PRODUCTION DEBUG] users.json encontrado com ${usersArr.length} usuários`);
                    if (usersArr.length > 0) {
                        usersArr.forEach((user, index) => {
                            const email = user && user.email ? user.email : '(sem email)';
                            const role = user && user.role ? user.role : '(sem role)';
                            console.log(`👤 [PRODUCTION DEBUG] Usuário ${index + 1}: ${email} (${role})`);
                        });
                    } else {
                        console.warn('⚠️ [PRODUCTION DEBUG] users.json não contém uma lista de usuários válida (array).');
                    }
                } else {
                    console.error('❌ [PRODUCTION DEBUG] users.json NÃO ENCONTRADO!');
                }
            } catch (error) {
                console.error('❌ [PRODUCTION DEBUG] Erro ao ler users.json:', error);
            }
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
app.get('/supplier-history/:id', requireAuth, requireRole(['admin', 'gerente']), (req, res) => {
    try {
        const id = req.params.id;
        const store = readSuppliersStore();
        const item = store.find(x => String(x.id) === String(id));
        if (!item) {
            return res.status(404).render('error', { user: req.session.user, message: 'Item not found' });
        }
        const user = req.session.user;
        const isAdmin = user.role === 'admin';
        const isManager = user.role === 'gerente';
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
    // Caso futuramente tenhamos uma fonte de registros, poderemos popular este array.
    const logs = [];
    const debugCounts = req.session.lastSearchDebugCounts || null;

    res.render('logs', {
        user,
        logs,
        debugCounts
    });
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
        if (!googleDriveService) {
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

    const users = userRepository.findAll();
    const marcelo = users.find(u => (u.email || '').toLowerCase() === 'marcelogalvis@mylokok.com');
    const jeison = users.find(u => (u.email || '').toLowerCase() === 'jeisonanteliz@mylokok.com');
    const managers = [marcelo, jeison].filter(Boolean);
    if (!managers.length) {
      return res.json({ managersFound: managers.length, counts: {}, total: 0 });
    }

    const allRecords = await readExcelData('ALL');

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

// Rota admin para importar/substituir o Excel local via URL
app.get('/admin/import-excel-from-url', requireAuth, requireAdmin, async (req, res) => {
  try {
    const sourceUrl = (req.query.url || '').trim();
    if (!sourceUrl) {
      return res.status(400).json({
        success: false,
        message: 'Parâmetro "url" é obrigatório. Ex: /admin/import-excel-from-url?url=https://.../arquivo.xlsx'
      });
    }
    const dataDir = path.join(__dirname, 'data');
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
    const destPath = path.join(dataDir, 'Wholesale Suppliers and Product Opportunities.xlsx');
    await downloadFileFromUrl(sourceUrl, destPath);

    let totalLokok = 0;
    try {
      const wb = XLSX.readFile(destPath);
      const ws = wb.Sheets['Wholesale LOKOK'] || wb.Sheets[wb.SheetNames[0]];
      if (ws) {
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        totalLokok = json.length;
      }
    } catch {}

    return res.json({
      success: true,
      message: 'Arquivo Excel importado e salvo com sucesso no data/.',
      dest: destPath,
      counts: { 'Wholesale LOKOK': totalLokok }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao importar Excel', error: err.message });
  }
});

// Rota admin para substituir Excel local pelo arquivo oficial do repositório
// Copia data/lokok2-export-US-20251119.xlsx para data/Wholesale Suppliers and Product Opportunities.xlsx
app.get('/admin/replace-excel-with-official', requireAuth, requireAdmin, async (req, res) => {
  try {
    const officialCandidates = [
      path.join(__dirname, 'data', 'lokok2-export-US-20251119.xlsx'),
      path.join(__dirname, 'Lokok2', 'data', 'lokok2-export-US-20251119.xlsx')
    ];
    const destPath = path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');

    let sourcePath = null;
    for (const p of officialCandidates) {
      if (fs.existsSync(p)) { sourcePath = p; break; }
    }
    if (!sourcePath) {
      return res.status(404).json({ success: false, message: 'Arquivo oficial não encontrado no servidor.' });
    }

    try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch {}
    fs.copyFileSync(sourcePath, destPath);

    let totalLokok = 0;
    try {
      const wb = XLSX.readFile(destPath);
      const ws = wb.Sheets['Wholesale LOKOK'] || wb.Sheets[wb.SheetNames[0]];
      if (ws) {
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        totalLokok = json.length;
      }
    } catch {}

    return res.json({
      success: true,
      message: 'Excel local substituído pelo arquivo oficial.',
      source: sourcePath,
      dest: destPath,
      counts: { 'Wholesale LOKOK': totalLokok }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao substituir Excel', error: err.message });
  }
});

// Rota aberta, somente quando em produção e FORCE_LOCAL_EXCEL=1
// Permite substituir o Excel ativo pelo oficial sem autenticação (para alinhamento rápido)
app.get('/api/replace-excel-with-official-open', async (req, res) => {
  try {
    if (process.env.NODE_ENV !== 'production') {
      return res.status(403).json({ success: false, message: 'Disponível apenas em produção' });
    }
    if (process.env.FORCE_LOCAL_EXCEL !== '1') {
      return res.status(403).json({ success: false, message: 'Disponível apenas quando FORCE_LOCAL_EXCEL=1' });
    }

    const officialCandidates = [
      path.join(__dirname, 'data', 'lokok2-export-US-20251119.xlsx'),
      path.join(__dirname, 'Lokok2', 'data', 'lokok2-export-US-20251119.xlsx')
    ];
    const destPath = path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');

    let sourcePath = null;
    for (const p of officialCandidates) {
      if (fs.existsSync(p)) { sourcePath = p; break; }
    }
    if (!sourcePath) {
      return res.status(404).json({ success: false, message: 'Arquivo oficial não encontrado no servidor.' });
    }

    try { fs.mkdirSync(path.dirname(destPath), { recursive: true }); } catch {}
    fs.copyFileSync(sourcePath, destPath);

    let totalLokok = 0;
    try {
      const wb = XLSX.readFile(destPath);
      const ws = wb.Sheets['Wholesale LOKOK'] || wb.Sheets[wb.SheetNames[0]];
      if (ws) {
        const json = XLSX.utils.sheet_to_json(ws, { defval: '' });
        totalLokok = json.length;
      }
    } catch {}

    return res.json({
      success: true,
      message: 'Excel local substituído pelo arquivo oficial (open).',
      source: sourcePath,
      dest: destPath,
      counts: { 'Wholesale LOKOK': totalLokok }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Falha ao substituir Excel (open)', error: err.message });
  }
});

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
    const forceLocal = process.env.FORCE_LOCAL_EXCEL === '1';
    const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL) && typeof getJsonSuppliers === 'function';
    const db_active = !forceLocal && useDb;
    const driveConfigured = !!googleDriveService;
    const excelPath = EXCEL_PATH || null;
    const selectedCountry = req.session.selectedCountry || 'US';
    const source = db_active ? 'database' : (driveConfigured ? 'googleDrive' : 'localExcel');

    let countsUS = null;
    try {
      if (db_active) {
        const dataUS = await getJsonSuppliers(['US']);
        countsUS = Array.isArray(dataUS) ? dataUS.length : null;
      } else {
        const dataUS = await readExcelData('US');
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

    if (db_active) {
      // Ocultar detalhes de Excel/Drive quando banco está ativo
      return res.json(base);
    }

    // Quando DB não está ativo, incluir detalhes de Excel/Drive para diagnóstico
    return res.json({
      ...base,
      driveConfigured,
      excelPath
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
    const data = await readExcelData(country === 'ALL' ? 'ALL' : country);
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
app.get('/admin/reset-base', requireAuth, requireAdmin, async (req, res) => {
    try {
        const info = { excelPath: EXCEL_PATH, actions: [] };
        // Limpar store local de fornecedores (pendências/approvals)
        try {
            writeSuppliersStore([]);
            info.actions.push('suppliers_store_cleared');
        } catch (e) {
            console.warn('Aviso: falha ao limpar suppliers store:', e?.message);
        }

        // Zerar abas preferidas no Excel
        if (!fs.existsSync(EXCEL_PATH)) {
            return res.status(500).json({ success: false, message: `Arquivo Excel não encontrado: ${EXCEL_PATH}` });
        }
        const wb = XLSX.readFile(EXCEL_PATH);
        const sheetNames = wb.SheetNames || [];
        const preferred = ['Wholesale LOKOK','Wholesale CANADA','Wholesale MEXICO','Wholesale CHINA'];
        const baseWs = sheetNames.includes('Wholesale LOKOK') ? wb.Sheets['Wholesale LOKOK'] : wb.Sheets[sheetNames[0]];
        const headers = inferHeadersFromWorksheet(baseWs);
        const emptyAoA = [headers];
        const emptyWS = XLSX.utils.aoa_to_sheet(emptyAoA);
        const cleared = {};
        for (const name of preferred) {
            try {
                wb.Sheets[name] = XLSX.utils.aoa_to_sheet(emptyAoA);
                if (!sheetNames.includes(name)) wb.SheetNames.push(name);
                cleared[name] = true;
            } catch (e) {
                cleared[name] = false;
            }
        }
        XLSX.writeFile(wb, EXCEL_PATH);
        info.actions.push('excel_preferred_sheets_cleared');
        info.cleared = cleared;
        console.log('🧹 [ADMIN] Reset de base concluído:', info);
        res.json({ success: true, message: 'Base resetada (Excel e suppliers.json)', info });
    } catch (e) {
        console.error('❌ [ADMIN] Falha no reset-base:', e);
        res.status(500).json({ success: false, message: 'Erro ao resetar base', error: e?.message });
    }
});

// Rota aberta (sem autenticação) para validar contagens no ambiente de desenvolvimento
// Usada apenas para conferência rápida quando FORCE_LOCAL_EXCEL=1
app.get('/api/debug-counts-open', async (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'development') {
            return res.status(403).json({ error: 'Disponível apenas em desenvolvimento' });
        }
        if (process.env.FORCE_LOCAL_EXCEL !== '1') {
            return res.status(403).json({ error: 'Disponível apenas quando FORCE_LOCAL_EXCEL=1' });
        }
        const us = await readExcelData('US');
        const ca = await readExcelData('CA');
        const mx = await readExcelData('MX');
        const cn = await readExcelData('CN');
        res.json({ counts: { US: us.length, CA: ca.length, MX: mx.length, CN: cn.length } });
    } catch (e) {
        console.error('[DEBUG] Erro em /api/debug-counts-open:', e);
        res.status(500).json({ error: 'Erro interno' });
    }
});

// Deduplicação direta no Excel (fallback), removendo entradas duplicadas por domínio/e-mail.
// Mantém o registro mais recente com base em Created_At (fallback para DATE).
app.get('/admin/deduplicate-excel', requireAuth, requireAdmin, async (req, res) => {
    try {
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            return res.status(400).json({ success: false, message: 'Fonte atual é banco de dados. Use /admin/deduplicate-suppliers.' });
        }

        const all = await readExcelData('ALL');
        if (!Array.isArray(all) || all.length === 0) {
            return res.json({ success: true, message: 'Nada a deduplicar (Excel vazio).', result: { total: 0, deleted: 0, kept: 0 } });
        }

        const normalizeHost = (s) => {
            let w = String(s || '').trim().toLowerCase();
            if (!w) return null;
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
            return w || null;
        };
        const normalizeEmail = (e) => { if (!e) return null; return String(e).trim().toLowerCase(); };
        const normalizeText = (t) => { if (!t) return null; return String(t).trim().toLowerCase(); };
        const getWebsite = (rec) => {
            if (!rec) return null;
            const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
                || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
            return candidate || null;
        };
        const getEmail = (rec) => rec && (rec['E-Mail'] || rec['Email'] || rec['EMAIL'] || rec.email) || null;
        const getName = (rec) => rec && (rec.Name || rec['Company Name'] || rec['COMPANY'] || rec['Empresa'] || rec['Distributor']) || null;
        const getCountry = (rec) => rec && (rec.Country || rec['COUNTRY']) || null;
        const getCreatedAt = (rec) => {
            const created = rec && (rec.Created_At || rec['Created At'] || rec.DATE || rec['Date']);
            const t = created ? new Date(created).getTime() : 0;
            return Number.isFinite(t) ? t : 0;
        };
        const canonicalCountry = (c) => {
            const v = String(c || '').trim().toUpperCase();
            if (['US','USA','UNITED STATES'].includes(v)) return 'US';
            if (['CA','CAN','CANADA'].includes(v)) return 'CA';
            if (['MX','MEX','MEXICO'].includes(v)) return 'MX';
            return 'US';
        };

        // Agrupar por chave e manter o mais recente
        const groups = new Map();
        const deletions = new Set();
        for (const rec of all) {
            const host = normalizeHost(getWebsite(rec));
            const email = normalizeEmail(getEmail(rec));
            const name = normalizeText(getName(rec));
            const country = normalizeText(getCountry(rec));
            let key = null;
            if (host) key = `w:${host}`; else if (email) key = `e:${email}`; else if (name) key = `n:${name}|${country || ''}`; else key = `obj:${JSON.stringify(rec).length}`;
            const prev = groups.get(key);
            if (!prev) {
                groups.set(key, rec);
            } else {
                const tPrev = getCreatedAt(prev);
                const tCur = getCreatedAt(rec);
                if (tCur >= tPrev) {
                    deletions.add(prev);
                    groups.set(key, rec);
                } else {
                    deletions.add(rec);
                }
            }
        }

        const kept = Array.from(groups.values());
        const deletedCount = deletions.size;
        const total = all.length;

        // Separar por país e regravar nas abas correspondentes
        const byCountry = { US: [], CA: [], MX: [] };
        for (const r of kept) {
            const code = canonicalCountry(getCountry(r));
            r.Country = code;
            byCountry[code].push(r);
        }

        // Escrever por país
        const okUS = await writeExcelData(byCountry.US, 'US');
        const okCA = await writeExcelData(byCountry.CA, 'CA');
        const okMX = await writeExcelData(byCountry.MX, 'MX');

        return res.json({
            success: true,
            message: 'Deduplicação no Excel concluída.',
            result: { total, deleted: deletedCount, kept: kept.length },
            writes: { US: okUS, CA: okCA, MX: okMX }
        });
    } catch (err) {
        console.error('Erro em /admin/deduplicate-excel:', err);
        return res.status(500).json({ success: false, message: 'Falha ao deduplicar Excel', error: err.message });
    }
});

// Variante aberta em desenvolvimento para acionar a deduplicação no Excel sem autenticação
app.get('/api/deduplicate-excel-open', async (req, res) => {
    try {
        if (process.env.NODE_ENV !== 'development') {
            return res.status(403).json({ success: false, message: 'Disponível apenas em desenvolvimento' });
        }
        if (process.env.FORCE_LOCAL_EXCEL !== '1') {
            return res.status(403).json({ success: false, message: 'Disponível apenas quando FORCE_LOCAL_EXCEL=1' });
        }
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            return res.status(400).json({ success: false, message: 'Fonte atual é banco de dados. Use /admin/deduplicate-suppliers.' });
        }

        // Reaproveitar lógica da rota admin
        const all = await readExcelData('ALL');
        if (!Array.isArray(all) || all.length === 0) {
            return res.json({ success: true, message: 'Nada a deduplicar (Excel vazio).', result: { total: 0, deleted: 0, kept: 0 } });
        }

        const normalizeHost = (s) => {
            let w = String(s || '').trim().toLowerCase();
            if (!w) return null;
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
            return w || null;
        };
        const normalizeEmail = (e) => { if (!e) return null; return String(e).trim().toLowerCase(); };
        const normalizeText = (t) => { if (!t) return null; return String(t).trim().toLowerCase(); };
        const getWebsite = (rec) => {
            if (!rec) return null;
            const candidate = (rec.distributor && (rec.distributor.Website || rec.distributor['WEBSITE'] || rec.distributor.URL || rec.distributor.Site))
                || rec.Website || rec['WEBSITE'] || rec.URL || rec.Site || rec.website;
            return candidate || null;
        };
        const getEmail = (rec) => rec && (rec['E-Mail'] || rec['Email'] || rec['EMAIL'] || rec.email) || null;
        const getName = (rec) => rec && (rec.Name || rec['Company Name'] || rec['COMPANY'] || rec['Empresa'] || rec['Distributor']) || null;
        const getCountry = (rec) => rec && (rec.Country || rec['COUNTRY']) || null;
        const getCreatedAt = (rec) => {
            const created = rec && (rec.Created_At || rec['Created At'] || rec.DATE || rec['Date']);
            const t = created ? new Date(created).getTime() : 0;
            return Number.isFinite(t) ? t : 0;
        };
        const canonicalCountry = (c) => {
            const v = String(c || '').trim().toUpperCase();
            if (['US','USA','UNITED STATES'].includes(v)) return 'US';
            if (['CA','CAN','CANADA'].includes(v)) return 'CA';
            if (['MX','MEX','MEXICO'].includes(v)) return 'MX';
            return 'US';
        };

        const groups = new Map();
        const deletions = new Set();
        for (const rec of all) {
            const host = normalizeHost(getWebsite(rec));
            const email = normalizeEmail(getEmail(rec));
            const name = normalizeText(getName(rec));
            const country = normalizeText(getCountry(rec));
            let key = null;
            if (host) key = `w:${host}`; else if (email) key = `e:${email}`; else if (name) key = `n:${name}|${country || ''}`; else key = `obj:${JSON.stringify(rec).length}`;
            const prev = groups.get(key);
            if (!prev) {
                groups.set(key, rec);
            } else {
                const tPrev = getCreatedAt(prev);
                const tCur = getCreatedAt(rec);
                if (tCur >= tPrev) {
                    deletions.add(prev);
                    groups.set(key, rec);
                } else {
                    deletions.add(rec);
                }
            }
        }

        const kept = Array.from(groups.values());
        const deletedCount = deletions.size;
        const total = all.length;

        const byCountry = { US: [], CA: [], MX: [] };
        for (const r of kept) {
            const code = canonicalCountry(getCountry(r));
            r.Country = code;
            byCountry[code].push(r);
        }

        const okUS = await writeExcelData(byCountry.US, 'US');
        const okCA = await writeExcelData(byCountry.CA, 'CA');
        const okMX = await writeExcelData(byCountry.MX, 'MX');

        return res.json({ success: true, message: 'Deduplicação no Excel concluída (open).', result: { total, deleted: deletedCount, kept: kept.length }, writes: { US: okUS, CA: okCA, MX: okMX } });
    } catch (err) {
        console.error('Erro em /api/deduplicate-excel-open:', err);
        return res.status(500).json({ success: false, message: 'Falha ao deduplicar Excel (open)', error: err.message });
    }
});

// Rota admin para persistir no Excel: tudo que estiver associado a "Nacho" passa a
// ter Created_By_* como Ignacio (ignaciocortez@mylokok.com) de forma permanente.
app.get('/admin/fix-nacho-createdby', requireAuth, requireAdmin, async (req, res) => {
    try {
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            return res.status(400).json({ success: false, message: 'Fonte atual é banco de dados. Esta operação atua diretamente no Excel.' });
        }

        const all = await readExcelData('ALL');
        if (!Array.isArray(all) || all.length === 0) {
            return res.json({ success: true, message: 'Nada a atualizar (Excel vazio).', total: 0, updated: 0 });
        }

        // Obter usuário do Ignacio/Nacho
        const targetEmail = 'ignaciocortez@mylokok.com';
        const users = userRepository.findAll ? userRepository.findAll() : [];
        const nachoUser = users.find(u => String(u.email || '').toLowerCase() === targetEmail)
            || users.find(u => String(u.name || '').toLowerCase() === 'nacho');
        if (!nachoUser) {
            return res.status(404).json({ success: false, message: 'Usuário Ignacio/Nacho não encontrado em users.json.' });
        }

        // Enriquecer em memória usando helper já existente
        let beforeNachoCount = 0;
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const emailLc = String(rec && rec.Created_By_User_Email || '').trim().toLowerCase();
            if (emailLc === String(nachoUser.email || '').trim().toLowerCase()) beforeNachoCount++;
        }
        enrichCreatedByForNacho(all);
        let afterNachoCount = 0;
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const emailLc = String(rec && rec.Created_By_User_Email || '').trim().toLowerCase();
            if (emailLc === String(nachoUser.email || '').trim().toLowerCase()) afterNachoCount++;
        }
        const updated = Math.max(0, afterNachoCount - beforeNachoCount);

        // Particionar por país e gravar nas abas correspondentes
        const getCountry = (rec) => rec && (rec.Country || rec['COUNTRY']) || null;
        const canonicalCountry = (c) => {
            const v = String(c || '').trim().toUpperCase();
            if (['US','USA','UNITED STATES'].includes(v)) return 'US';
            if (['CA','CAN','CANADA'].includes(v)) return 'CA';
            if (['MX','MEX','MEXICO'].includes(v)) return 'MX';
            return 'US';
        };
        const byCountry = { US: [], CA: [], MX: [] };
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const code = canonicalCountry(getCountry(rec));
            rec.Country = code;
            byCountry[code].push(rec);
        }

        const okUS = await writeExcelData(byCountry.US, 'US');
        const okCA = await writeExcelData(byCountry.CA, 'CA');
        const okMX = await writeExcelData(byCountry.MX, 'MX');

        return res.json({
            success: true,
            message: 'Persistência concluída: registros de "Nacho" agora aparecem como criados por Ignacio.',
            total: all.length,
            nachoCreatedBefore: beforeNachoCount,
            nachoCreatedAfter: afterNachoCount,
            updated,
            writes: { US: okUS, CA: okCA, MX: okMX }
        });
    } catch (err) {
        console.error('Erro em /admin/fix-nacho-createdby:', err);
        return res.status(500).json({ success: false, message: 'Falha ao persistir Created_By_* para Nacho/Igancio', error: err.message });
    }
});

// Variante aberta em desenvolvimento para acionar a persistência sem autenticação
app.get('/api/fix-nacho-createdby-open', async (req, res) => {
    try {
        if ((process.env.NODE_ENV || 'development') !== 'development') {
            return res.status(403).json({ success: false, message: 'Disponível apenas em desenvolvimento' });
        }
        const useDb = (process.env.USE_DB === 'true' || !!process.env.DATABASE_URL);
        if (useDb) {
            return res.status(400).json({ success: false, message: 'Fonte atual é banco de dados. Esta operação atua diretamente no Excel.' });
        }

        const all = await readExcelData('ALL');
        if (!Array.isArray(all) || all.length === 0) {
            return res.json({ success: true, message: 'Nada a atualizar (Excel vazio).', total: 0, updated: 0 });
        }

        const targetEmail = 'ignaciocortez@mylokok.com';
        const users = userRepository.findAll ? userRepository.findAll() : [];
        const nachoUser = users.find(u => String(u.email || '').toLowerCase() === targetEmail)
            || users.find(u => String(u.name || '').toLowerCase() === 'nacho');
        if (!nachoUser) {
            return res.status(404).json({ success: false, message: 'Usuário Ignacio/Nacho não encontrado em users.json.' });
        }

        let beforeNachoCount = 0;
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const emailLc = String(rec && rec.Created_By_User_Email || '').trim().toLowerCase();
            if (emailLc === String(nachoUser.email || '').trim().toLowerCase()) beforeNachoCount++;
        }
        enrichCreatedByForNacho(all);
        let afterNachoCount = 0;
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const emailLc = String(rec && rec.Created_By_User_Email || '').trim().toLowerCase();
            if (emailLc === String(nachoUser.email || '').trim().toLowerCase()) afterNachoCount++;
        }
        const updated = Math.max(0, afterNachoCount - beforeNachoCount);

        const getCountry = (rec) => rec && (rec.Country || rec['COUNTRY']) || null;
        const canonicalCountry = (c) => {
            const v = String(c || '').trim().toUpperCase();
            if (['US','USA','UNITED STATES'].includes(v)) return 'US';
            if (['CA','CAN','CANADA'].includes(v)) return 'CA';
            if (['MX','MEX','MEXICO'].includes(v)) return 'MX';
            return 'US';
        };
        const byCountry = { US: [], CA: [], MX: [] };
        for (const r of all) {
            const rec = r && r.distributor ? r.distributor : r;
            const code = canonicalCountry(getCountry(rec));
            rec.Country = code;
            byCountry[code].push(rec);
        }

        const okUS = await writeExcelData(byCountry.US, 'US');
        const okCA = await writeExcelData(byCountry.CA, 'CA');
        const okMX = await writeExcelData(byCountry.MX, 'MX');

        return res.json({
            success: true,
            message: 'Persistência concluída (open): registros de "Nacho" agora aparecem como criados por Ignacio.',
            total: all.length,
            nachoCreatedBefore: beforeNachoCount,
            nachoCreatedAfter: afterNachoCount,
            updated,
            writes: { US: okUS, CA: okCA, MX: okMX }
        });
    } catch (err) {
        console.error('Erro em /api/fix-nacho-createdby-open:', err);
        return res.status(500).json({ success: false, message: 'Falha ao persistir Created_By_* (open)', error: err.message });
    }
});
