const express = require('express');
<<<<<<< HEAD
const cookieSession = require('cookie-session');
=======
const session = require('express-session');
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
const cookieParser = require('cookie-parser');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { User, UserRepository } = require('./models/User');
const { pool, initializeDatabase } = require('./database');
<<<<<<< HEAD
const GoogleDriveService = require('./googleDriveService');

const app = express();
try { fs.mkdirSync('./logs', { recursive: true }); } catch {}
=======
const auditLogger = require('./audit');
const GoogleDriveService = require('./googleDriveService');

const app = express();
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Configuração do middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
<<<<<<< HEAD
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

=======
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET || 'lokok-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: NODE_ENV === 'production', 
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

// Servir arquivos estáticos
app.use(express.static('public'));

>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

<<<<<<< HEAD
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
    // Em desenvolvimento, resolver dinamicamente o caminho do Excel local
    const candidates = [
        // Priorizar sempre a planilha oficial de 1109 se existir
        path.join(__dirname, 'data', 'lokok2-export-US-20251119.xlsx'),
        path.join(__dirname, 'Lokok2', 'data', 'lokok2-export-US-20251119.xlsx'),
        // Em seguida qualquer configuração via variável de ambiente
        process.env.EXCEL_PATH,
        // Demais candidatos legados
        path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
        path.join(__dirname, 'Lokok2', 'data', 'Wholesale Suppliers and Product Opportunities.xlsx'),
        path.join(__dirname, 'data', 'cached_spreadsheet.xlsx'),
        path.join(__dirname, 'Lokok2', 'data', 'cached_spreadsheet.xlsx'),
    ].filter(Boolean);
    for (const p of candidates) {
        try {
            if (fs.existsSync(p)) {
                EXCEL_PATH = p;
                break;
            }
        } catch (e) {
            // ignora erros de acesso
        }
    }
    if (EXCEL_PATH) {
        console.log('📊 [PRODUCTION DEBUG] Configurado para usar arquivo Excel local:', EXCEL_PATH);
    } else {
        console.warn('⚠️ [PRODUCTION DEBUG] Nenhum arquivo Excel encontrado nos caminhos padrão. As buscas retornarão 0 resultados.');
    }
}

// Logs detalhados para produção
console.log('🚀 [PRODUCTION DEBUG] Iniciando servidor LOKOK2...');
console.log('🌍 [PRODUCTION DEBUG] NODE_ENV:', process.env.NODE_ENV);
console.log('📁 [PRODUCTION DEBUG] __dirname:', __dirname);
console.log('📁 [PRODUCTION DEBUG] process.cwd():', process.cwd());
=======
// Caminho para a planilha Excel
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)

// Instância do repositório de usuários
const userRepository = new UserRepository();

<<<<<<< HEAD
=======
// Instância do serviço Google Drive
const googleDriveService = new GoogleDriveService();

>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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
    if (req.session.user && ['admin', 'gerente'].includes(req.session.user.role)) {
        next();
    } else {
        res.status(403).send('Access denied');
    }
}

<<<<<<< HEAD
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
    if (c === 'CN') return 'Wholesale CHINA';
    return 'Export_US'; // US preferir Export_US
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

function ensureCountrySheets(workbook) {
    if (!workbook || !workbook.SheetNames) return { changed: false };
    const sheetNames = workbook.SheetNames;
    const hasUS = sheetNames.includes('Wholesale LOKOK');
    const hasCA = sheetNames.includes('Wholesale CANADA');
    const hasMX = sheetNames.includes('Wholesale MEXICO');
    const hasCN = sheetNames.includes('Wholesale CHINA');
    let changed = false;

    // Base de cabeçalhos: tenta da aba US ou da primeira aba
    const baseWs = hasUS ? workbook.Sheets['Wholesale LOKOK'] : workbook.Sheets[sheetNames[0]];
    const headers = inferHeadersFromWorksheet(baseWs);
    const emptySheetAoA = [headers];
    const emptyWS_CA = XLSX.utils.aoa_to_sheet(emptySheetAoA);
    const emptyWS_MX = XLSX.utils.aoa_to_sheet(emptySheetAoA);
    const emptyWS_CN = XLSX.utils.aoa_to_sheet(emptySheetAoA);

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
    if (!hasCN) {
        workbook.Sheets['Wholesale CHINA'] = emptyWS_CN;
        workbook.SheetNames.push('Wholesale CHINA');
        changed = true;
        console.log('📄 Criada aba vazia: Wholesale CHINA');
    }

    return { changed };
}

// Função para ler dados da planilha
async function readExcelData(selectedCountry) {
    try {
        let allData = [];
        const sheetMap = {
            US: 'Export_US',
            CA: 'Wholesale CANADA',
            MX: 'Wholesale MEXICO',
            CN: 'Wholesale CHINA'
        };
        const targetSheet = selectedCountry && sheetMap[selectedCountry] ? sheetMap[selectedCountry] : null;
        
        if (NODE_ENV === 'production' && googleDriveService) {
            // Em produção, usar Google Drive
            console.log('📥 [PRODUCTION DEBUG] Carregando dados do Google Drive...');
            try {
                allData = await googleDriveService.readSpreadsheetData(selectedCountry);
                console.log('✅ [PRODUCTION DEBUG] Dados carregados do Google Drive:', allData.length, 'registros');
                // Filtrar por país se solicitado (quando houver campo Country)
                // Para US, manter todos os registros da aba padrão sem filtrar
                if (selectedCountry && selectedCountry !== 'US') {
                    const before = allData.length;
                    const aliases = getCountryAliases(selectedCountry);
                    allData = allData.filter(r => {
                        const c = r.Country || r.PAIS || r.País || r['COUNTRY'];
                        const cu = c ? String(c).toUpperCase() : '';
                        // Quando há país selecionado, não incluir registros sem país explícito
                        return c ? aliases.some(a => cu.includes(a)) : false;
                    });
                    console.log(`[PRODUCTION DEBUG] Filtro por país (${selectedCountry}) aplicado: ${before} -> ${allData.length}`);
                }
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
                    
                    const preferredSheets = ['Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO', 'Wholesale CHINA'];
                    const existingPreferred = preferredSheets.filter(name => sheetNames.includes(name));
                    
                    if (selectedCountry && targetSheet && sheetNames.includes(targetSheet)) {
                        console.log('[PRODUCTION DEBUG] Lendo aba específica para país selecionado:', targetSheet);
                        const ws = workbook.Sheets[targetSheet];
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
            const preferredSheets = ['Export_US', 'Wholesale LOKOK', 'Wholesale CANADA', 'Wholesale MEXICO', 'Wholesale CHINA'];
            const existingPreferred = preferredSheets.filter(name => sheetNames.includes(name));

            if (selectedCountry && targetSheet && sheetNames.includes(targetSheet)) {
                const ws = workbook.Sheets[targetSheet];
                const rows = XLSX.utils.sheet_to_json(ws);
                console.log('[PRODUCTION DEBUG] Lendo aba selecionada:', targetSheet, 'Registros:', rows.length);
                allData = allData.concat(rows);
            } else if (existingPreferred.length > 0) {
                for (const name of existingPreferred) {
                    const ws = workbook.Sheets[name];
                    const rows = XLSX.utils.sheet_to_json(ws);
                    console.log('[PRODUCTION DEBUG] Lendo aba preferida:', name, 'Registros:', rows.length);
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
        
        console.log(`✅ [PRODUCTION DEBUG] Dados carregados: ${allData.length} registros`);
        return allData;
    } catch (error) {
        console.error('❌ [PRODUCTION DEBUG] Error reading spreadsheet:', error);
        console.error('❌ [PRODUCTION DEBUG] Stack trace:', error.stack);
=======
// Função para ler dados da planilha do Google Drive
async function readExcelData() {
    try {
        const spreadsheetPath = await googleDriveService.getSpreadsheetPath();
        const workbook = XLSX.readFile(spreadsheetPath);
        let allData = [];
        
        // Ler aba 'Wholesale LOKOK' (primeira aba)
        if (workbook.SheetNames.includes('Wholesale LOKOK')) {
            const worksheet1 = workbook.Sheets['Wholesale LOKOK'];
            const data1 = XLSX.utils.sheet_to_json(worksheet1);
            allData = allData.concat(data1);
        }
        
        // Ler aba 'Wholesale CANADA' (segunda aba)
        if (workbook.SheetNames.includes('Wholesale CANADA')) {
            const worksheet2 = workbook.Sheets['Wholesale CANADA'];
            const data2 = XLSX.utils.sheet_to_json(worksheet2);
            allData = allData.concat(data2);
        }
        
        console.log(`Dados carregados: ${allData.length} registros de ${workbook.SheetNames.length} abas`);
        return allData;
    } catch (error) {
        console.error('Error reading spreadsheet:', error);
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        return [];
    }
}

// Função para escrever dados na planilha
<<<<<<< HEAD
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
=======
async function writeExcelData(data) {
    try {
        await googleDriveService.saveSpreadsheetData(data);
        return true;
    } catch (error) {
        console.error('Error writing to spreadsheet:', error);
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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
<<<<<<< HEAD
    console.log('[PRODUCTION DEBUG] Tentativa de login para:', email);
    console.log('[PRODUCTION DEBUG] IP do cliente:', req.ip);
    console.log('[PRODUCTION DEBUG] User-Agent:', req.get('User-Agent'));
    console.log('[PRODUCTION DEBUG] Password length:', password?.length);
    
    const user = userRepository.findByEmail(email);
    console.log('[PRODUCTION DEBUG] Usuário encontrado:', user ? { id: user.id, email: user.email, role: user.role } : 'null');
    
    if (user && User.comparePassword(password, user.password)) {
        console.log('[PRODUCTION DEBUG] Login bem-sucedido para:', email);
        console.log('[PRODUCTION DEBUG] Configurando sessão para usuário:', { id: user.id, email: user.email, role: user.role });
=======
    const user = userRepository.findByEmail(email);
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || '';
    
    if (user && User.comparePassword(password, user.password)) {
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        req.session.user = {
            id: user.id,
            email: user.email,
            role: user.role,
<<<<<<< HEAD
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
=======
            name: user.name
        };
        
        // Log de acesso bem-sucedido
        auditLogger.logAccess('LOGIN_SUCCESS', user.email, clientIP, userAgent);
        
        res.redirect('/dashboard');
    } else {
        // Log de tentativa de login falhada
        auditLogger.logAccess('LOGIN_FAILED', email || 'unknown', clientIP, userAgent);
        
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        res.render('login', { error: 'Invalid email or password' });
    }
});

app.get('/logout', (req, res) => {
<<<<<<< HEAD
    req.session = null;
    res.redirect('/login');
});

// Rota administrativa para exportar registros em Excel (com todas as colunas)
// Uso: GET /admin/export-excel?country=US
app.get('/admin/export-excel', requireAdmin, async (req, res) => {
    try {
        const country = String(req.query.country || 'US').toUpperCase();
        const data = await readExcelData(country);

        const headerSet = new Set([
            'Name','Website','CATEGORÍA','Account Request Status','DATE','Responsable',
            'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)',
            'Description/Notes','Contact Name','Contact Phone','E-Mail','Address','User','PASSWORD',
            'LLAMAR','PRIO (1 - TOP, 5 - baixo)','Comments','Country','Created_By_User_ID','Created_By_User_Name','Created_At'
        ]);
        for (const record of Array.isArray(data) ? data : []) {
            Object.keys(record || {}).forEach(k => headerSet.add(k));
        }
        const headers = Array.from(headerSet);

        const rows = (Array.isArray(data) ? data : []).map(rec => {
            const row = {};
            for (const h of headers) {
                row[h] = rec && rec[h] !== undefined ? rec[h] : '';
            }
            return row;
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
        XLSX.utils.book_append_sheet(wb, ws, `Export_${country}`);

        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const date = new Date();
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const fileName = `lokok2-export-${country}-${y}${m}${d}.xlsx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=${fileName}`);
        res.status(200).send(buf);
    } catch (err) {
        console.error('Erro na rota /admin/export-excel:', err);
        res.status(500).json({ error: 'Failed to export Excel', details: err?.message });
    }
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
        console.log('[PRODUCTION DEBUG] Dados carregados:', data.length, 'registros');
=======
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const userEmail = req.session.user ? req.session.user.email : 'unknown';
    
    // Log de logout
    auditLogger.logAccess('LOGOUT', userEmail, clientIP);
    
    req.session.destroy();
    res.redirect('/login');
});

// Rota principal - Dashboard
app.get('/dashboard', requireAuth, async (req, res) => {
    const data = await readExcelData();
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    
    // Filtrar dados por usuário (apenas registros que eles criaram, exceto admin)
    let filteredData = data;
    if (req.session.user.role !== 'admin') {
        // Para usuários não-admin, filtrar por nome no campo Responsable
        const userName = req.session.user.name;
        filteredData = data.filter(record => {
            const responsible = record['Responsable'] || '';
            return responsible.toLowerCase().includes(userName.toLowerCase());
        });
    }
<<<<<<< HEAD

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
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    
    // Processar dados para estatísticas
    const categoryStats = {};
    const responsibleStats = {};
    const monthlyStats = {};
<<<<<<< HEAD
    const monthlyResponsibles = {}; // { 'YYYY-MM': { responsibleName: count } }
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    
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
<<<<<<< HEAD
                    const respName = record['Responsable'] || 'Não especificado';
                    if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                    monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
                } else {
                    // Data inválida - usar distribuição simulada
                    const currentDate = new Date();
                    const randomMonthsAgo = Math.floor(Math.random() * 12);
                    const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                    const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                    monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
<<<<<<< HEAD
                    const respName = record['Responsable'] || 'Não especificado';
                    if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                    monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
                }
            } catch (e) {
                // Erro ao processar data - usar distribuição simulada
                const currentDate = new Date();
                const randomMonthsAgo = Math.floor(Math.random() * 12);
                const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
<<<<<<< HEAD
                const respName = record['Responsable'] || 'Não especificado';
                if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
                monthlyResponsibles[monthKey][respName] = (monthlyResponsibles[monthKey][respName] || 0) + 1;
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            }
        } else {
            // Sem data - usar distribuição simulada
            const currentDate = new Date();
            const randomMonthsAgo = Math.floor(Math.random() * 12);
            const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
            const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
<<<<<<< HEAD
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

=======
        }
    });
    
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    const stats = {
        totalRecords: filteredData.length,
        categoryStats,
        responsibleStats,
        monthlyStats
    };
<<<<<<< HEAD
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
    const managers = userRepository.findAll().filter(u => u.role === 'gerente');
    const managersList = managers.map(u => ({ id: u.id, name: u.name, email: u.email }));
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    res.render('form', { user: req.session.user, managersList, selectedCountry });
=======
    
    res.render('dashboard', {
        user: req.session.user,
        stats,
        data: filteredData
    });
});

app.get('/form', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('form', { user: req.session.user });
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
});

app.get('/bulk-upload', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('bulk-upload', { user: req.session.user });
});

app.post('/add-record', requireAuth, requireManagerOrAdmin, async (req, res) => {
<<<<<<< HEAD
    const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
    const data = await readExcelData(selectedCountry);
=======
    const data = await readExcelData();
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date();
    
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    const newRecord = {
        'Name': req.body.name,
        'Website': req.body.website,
        'CATEGORÍA': req.body.categoria,
        'Account Request Status': req.body.accountStatus,
        'DATE': req.body.date,
        'Responsable': req.body.responsable,
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
<<<<<<< HEAD
        'Country': selectedCountry,
        'Created_By_User_ID': req.session.user.id,
        'Created_By_User_Name': req.session.user.name,
        'Created_At': new Date().toISOString()
    };
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
    
    data.push(newRecord);
    
    const saved = await writeExcelData(data, selectedCountry);
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
    
    if (saved) {
=======
        'Created_By_User_ID': req.session.user.id,
        'Created_By_User_Name': req.session.user.name,
        'Created_At': timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        'Updated_At': '',
        'Updated_By_User_Name': '',
        'Updated_By_User_ID': ''
    };
    
    data.push(newRecord);
    
    if (await writeExcelData(data, selectedCountry)) {
        // Log da atividade de criação
        auditLogger.logActivity('CREATE_RECORD', req.session.user.email, 'Supplier/Distributor', 
            `Nome: ${req.body.name}, Categoria: ${req.body.categoria}`, clientIP);
        
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        res.json({ success: true, message: 'Record added successfully!' });
    } else {
        res.json({ success: false, message: 'Error adding record.' });
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
<<<<<<< HEAD
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
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        
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
<<<<<<< HEAD
            createdBy: req.session.user.id,
            allowedCountries: allowedCountries
=======
            createdBy: req.session.user.id
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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
<<<<<<< HEAD
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
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        
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
<<<<<<< HEAD
            role,
            allowedCountries
=======
            role
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
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
<<<<<<< HEAD
=======
            // Log da atividade de exclusão de usuário
            const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
            auditLogger.logActivity('DELETE_USER', req.session.user.email, 'User', 
                `Usuário ID ${userId} excluído`, clientIP);
            
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

<<<<<<< HEAD
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

=======
// Rota para página de logs (apenas administradores)
app.get('/logs', requireAuth, requireAdmin, (req, res) => {
    try {
        const { logType, userFilter, startDate, endDate, export: exportCsv } = req.query;
        
        // Ler logs de acesso e atividade
        const accessLogs = auditLogger.getAccessLogs();
        const activityLogs = auditLogger.getActivityLogs();
        
        // Combinar e ordenar logs
        let allLogs = [];
        
        // Processar logs de acesso
        accessLogs.forEach(log => {
            allLogs.push({
                timestamp: log.timestamp,
                type: 'ACCESS',
                user: log.username,
                action: log.action,
                details: log.userAgent || '',
                ip: log.ip || 'N/A'
            });
        });
        
        // Processar logs de atividade
        activityLogs.forEach(log => {
            allLogs.push({
                timestamp: log.timestamp,
                type: 'ACTIVITY',
                user: log.username,
                action: log.action,
                details: log.details || '',
                ip: log.ip || 'N/A'
            });
        });
        
        // Ordenar por timestamp (mais recente primeiro)
        allLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        // Aplicar filtros
        if (logType && logType !== 'all') {
            if (logType === 'access') {
                allLogs = allLogs.filter(log => log.type === 'ACCESS');
            } else if (logType === 'activity') {
                allLogs = allLogs.filter(log => log.type === 'ACTIVITY');
            }
        }
        
        if (userFilter) {
            allLogs = allLogs.filter(log => 
                log.user.toLowerCase().includes(userFilter.toLowerCase())
            );
        }
        
        if (startDate) {
            const start = new Date(startDate);
            allLogs = allLogs.filter(log => new Date(log.timestamp) >= start);
        }
        
        if (endDate) {
            const end = new Date(endDate + 'T23:59:59');
            allLogs = allLogs.filter(log => new Date(log.timestamp) <= end);
        }
        
        // Exportar CSV se solicitado
        if (exportCsv === 'csv') {
            const csv = 'Data/Hora,Tipo,Usuário,Ação,Detalhes,IP\n' + 
                allLogs.map(log => 
                    `"${log.timestamp}","${log.type}","${log.user}","${log.action}","${log.details}","${log.ip}"`
                ).join('\n');
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="logs_sistema.csv"');
            return res.send(csv);
        }
        
        // Limitar a 1000 registros para performance
        allLogs = allLogs.slice(0, 1000);
        
        res.render('logs', {
            user: req.session.user,
            logs: allLogs,
            filters: { logType, userFilter, startDate, endDate }
        });
        
    } catch (error) {
        console.error('Erro ao carregar logs:', error);
        res.render('error', {
            user: req.session.user,
            message: 'Erro ao carregar logs do sistema'
        });
    }
});

// Rota de busca
app.get('/search', requireAuth, async (req, res) => {
    const { query, type } = req.query;
    let data = await readExcelData();
    
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    // Adicionar índice real e metadados de país a cada registro
    data = data.map((record, index) => ({
        ...record,
        _realIndex: index,
        _realIndexCountry: index,
        _countryCode: selectedCountry
    }));
    
    // Para gerentes, mostrar todos os distribuidores mas com campos limitados para os que não são responsáveis
    if (req.session.user.role === 'gerente') {
        // Não filtrar os dados, mas marcar quais são do usuário para controle de exibição
        const userName = req.session.user.name;
        data = data.map(record => {
<<<<<<< HEAD
            const responsible = getField(record, ['Responsable','Manager','Buyer']);
            const isResponsible = ((responsible || '') + '').toLowerCase().includes(((userName || '') + '').toLowerCase());
=======
            const responsible = record['Responsable'] || '';
            const isResponsible = responsible.toLowerCase().includes(userName.toLowerCase());
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            return {
                ...record,
                _isResponsible: isResponsible
            };
        });
    } else if (req.session.user.role !== 'admin') {
<<<<<<< HEAD
        // Para outros usuários não-admin:
        // Sempre permitir visualizar todos os registros, marcando _isResponsible para controle de exibição
        const userName = req.session.user.name;
        data = data.map(record => {
            const responsible = getField(record, ['Responsable','Manager','Buyer']);
            const isResponsible = ((responsible || '') + '').toLowerCase().includes(((userName || '') + '').toLowerCase());
            return {
                ...record,
                _isResponsible: isResponsible
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
        // buyer/manager alias-aware
        if (typeof req.query.buyer === 'string' && req.query.buyer.trim().length > 0) {
            const buyerTerm = normalize(req.query.buyer);
            const buyerAliases = [buyerTerm, ...(buyerTerm === 'nacho' ? ['ignacio'] : [])];
            const before = resultsAdvanced.length;
            resultsAdvanced = resultsAdvanced.filter(record => {
                const mgrNorm = normalize(getField(record, ['Responsable','Manager','Buyer']));
                return !!mgrNorm && buyerAliases.some(a => mgrNorm.includes(a));
            });
            console.log('[SEARCH DEBUG] resultsAdvanced buyer alias count:', resultsAdvanced.length, 'buyerTerm:', buyerTerm, 'before:', before);
            buyerFilterCount = resultsAdvanced.length;
        }
        if (category && category.trim()) {
            const term = normalize(category);
            const before = resultsAdvanced.length;
            resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, ['CATEGORÍA','Category'])).includes(term));
            console.log('[SEARCH DEBUG] category filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
        }
        if (accountStatus && accountStatus.trim()) {
            const term = normalize(accountStatus);
            const before = resultsAdvanced.length;
            resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, ['Account Request Status','Account Status'])) === term);
            console.log('[SEARCH DEBUG] accountStatus filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
        }
        if (status && status.trim()) {
            const term = normalize(status);
            const before = resultsAdvanced.length;
            resultsAdvanced = resultsAdvanced.filter(record => normalize(getField(record, [fieldStatusName])) === term);
            console.log('[SEARCH DEBUG] status filter term:', term, 'before:', before, 'after:', resultsAdvanced.length);
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
    
    // Persistir contadores de debug na sessão e adicionar rota /logs que renderiza a nova aba de Logs. Remover envio de debugCounts para a página de busca.
    const debugCounts = {
        resultsQueryCount: resultsQuery ? resultsQuery.length : 0,
        resultsAdvancedBuyerAliasCount: buyerFilterCount,
        combinedResultsCount: results.length
    };
    req.session.lastSearchDebugCounts = debugCounts;
=======
        // Para outros usuários não-admin, filtrar por nome no campo Responsable
        const userName = req.session.user.name;
        data = data.filter(record => {
            const responsible = record['Responsable'] || '';
            return responsible.toLowerCase().includes(userName.toLowerCase());
        });
    }
    
    let results = [];
    if (query) {
        results = data.filter(record => {
            switch (type) {
                case 'name':
                    return record.Name && record.Name.toLowerCase().includes(query.toLowerCase());
                case 'website':
                    return record.Website && record.Website.toLowerCase().includes(query.toLowerCase());
                case 'categoria':
                    return record['CATEGORÍA'] && record['CATEGORÍA'].toLowerCase().includes(query.toLowerCase());
                default:
                    return (record.Name && record.Name.toLowerCase().includes(query.toLowerCase())) ||
                           (record.Website && record.Website.toLowerCase().includes(query.toLowerCase())) ||
                           (record['CATEGORÍA'] && record['CATEGORÍA'].toLowerCase().includes(query.toLowerCase()));
            }
        });
    }
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    
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
        listAll
    });
});

// Rota GET para exibir formulário de edição
app.get('/edit/:id', requireAuth, async (req, res) => {
    // Permitir override via query (?country=US|CA|MX) respeitando países permitidos
    const user = req.session.user;
    const requestedCountry = String(req.query.country || '').toUpperCase();
    const allowed = Array.isArray(user?.allowedCountries) ? user.allowedCountries.map(c => String(c).toUpperCase()) : [];
    const isAllowed = user.role === 'admin' || (requestedCountry && allowed.includes(requestedCountry));
    const selectedCountry = isAllowed ? requestedCountry : (req.session.selectedCountry || (allowed[0] || 'US'));

    const data = await readExcelData(selectedCountry);
    const recordId = parseInt(req.params.id);
    
    
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
        user: user,
        selectedCountry
    });
});

// Rota POST para processar alterações
app.post('/edit/:id', requireAuth, async (req, res) => {
    // Permitir override via query/body, respeitando países permitidos
    const user = req.session.user;
    const requestedCountryRaw = req.query.country || req.body.country || '';
    const requestedCountry = String(requestedCountryRaw).toUpperCase();
    const allowed = Array.isArray(user?.allowedCountries) ? user.allowedCountries.map(c => String(c).toUpperCase()) : [];
    const isAllowed = user.role === 'admin' || (requestedCountry && allowed.includes(requestedCountry));
    const selectedCountry = isAllowed ? requestedCountry : (req.session.selectedCountry || (allowed[0] || 'US'));

    const data = await readExcelData(selectedCountry);
    const recordId = parseInt(req.params.id);
    
    
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
        if (!responsaveis.includes(user.name)) {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. You can only edit distributors you are responsible for.' 
            });
        }
    }
    
    // Atualizar os campos do registro
    const {
        name,
        website,
        categoria,
        accountRequestStatus,
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
    
<<<<<<< HEAD
    // Atualizar apenas os campos fornecidos
    if (name !== undefined) data[recordId].Name = name;
    if (website !== undefined) data[recordId].Website = website;
    if (categoria !== undefined) data[recordId]['CATEGORÍA'] = categoria;
=======
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date();
    const originalName = data[recordId].Name;
    const changedFields = [];
    
    // Atualizar apenas os campos fornecidos e registrar mudanças
    if (name !== undefined && data[recordId].Name !== name) {
        data[recordId].Name = name;
        changedFields.push(`Nome: ${originalName} → ${name}`);
    }
    if (website !== undefined && data[recordId].Website !== website) {
        changedFields.push(`Website: ${data[recordId].Website} → ${website}`);
        data[recordId].Website = website;
    }
    if (categoria !== undefined && data[recordId]['CATEGORÍA'] !== categoria) {
        changedFields.push(`Categoria: ${data[recordId]['CATEGORÍA']} → ${categoria}`);
        data[recordId]['CATEGORÍA'] = categoria;
    }
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    if (accountRequestStatus !== undefined) data[recordId]['Account Request Status'] = accountRequestStatus;
    if (generalStatus !== undefined) data[recordId]['General Status'] = generalStatus;
    if (responsable !== undefined) data[recordId].Responsable = responsable;
    if (contactName !== undefined) data[recordId]['Contact Name'] = contactName;
    if (contactEmail !== undefined) data[recordId]['Contact Email'] = contactEmail;
    if (contactPhone !== undefined) data[recordId]['Contact Phone'] = contactPhone;
    if (address !== undefined) data[recordId].Address = address;
    if (city !== undefined) data[recordId].City = city;
    if (state !== undefined) data[recordId].State = state;
    if (country !== undefined) data[recordId].Country = country;
    if (zipCode !== undefined) data[recordId]['Zip Code'] = zipCode;
    
<<<<<<< HEAD
    // Salvar alterações na planilha Excel
    const saveSuccess = await writeExcelData(data, selectedCountry);
=======
    // Atualizar timestamp de modificação
    data[recordId]['Updated_At'] = timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    data[recordId]['Updated_By_User_Name'] = user.name;
    data[recordId]['Updated_By_User_ID'] = user.id;
    
    // Salvar alterações na planilha Excel
    const saveSuccess = await writeExcelData(data, selectedCountry);
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    if (!saveSuccess) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error saving changes to spreadsheet. Please try again.' 
        });
    }
    
<<<<<<< HEAD
=======
    // Log da atividade de edição
    if (changedFields.length > 0) {
        auditLogger.logActivity('UPDATE_RECORD', user.email, 'Supplier/Distributor', 
            `ID: ${recordId}, ${changedFields.join(', ')}`, clientIP);
    }
    
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
    res.json({ success: true, message: 'Record updated successfully!' });
});

// Rota DELETE para remover um registro com suporte a país
app.delete('/records/:id', requireAuth, async (req, res) => {
    try {
        const user = req.session.user;
        const requestedCountryRaw = req.query.country || '';
        const requestedCountry = String(requestedCountryRaw).toUpperCase();
        const allowed = Array.isArray(user?.allowedCountries) ? user.allowedCountries.map(c => String(c).toUpperCase()) : [];
        const isAllowed = user.role === 'admin' || (requestedCountry && allowed.includes(requestedCountry));
        const selectedCountry = isAllowed ? requestedCountry : (req.session.selectedCountry || (allowed[0] || 'US'));

        const data = await readExcelData(selectedCountry);
        const recordId = parseInt(req.params.id);

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

        // Remover o registro pelo índice
        data.splice(recordId, 1);

        const saveSuccess = await writeExcelData(data, selectedCountry);
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
<<<<<<< HEAD
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
=======
        // Criar um workbook com template
        const wb = XLSX.utils.book_new();
        
        // Dados de exemplo para o template
        const templateData = [
            {
                'Company Name': 'Example Company Ltd',
                'Website': 'https://example.com',
                'Category': 'Electronics',
                'Account Status': 'PENDING',
                'Date': '2024-01-15',
                'Manager': 'John Doe',
                'Status': 'PENDING APPROVAL',
                'Description': 'Example supplier description',
                'Contact Name': 'Jane Smith',
                'Contact Email': 'jane@example.com',
                'Contact Phone': '+1-555-0123',
                'Contact Position': 'Sales Manager',
                'Address': '123 Business St',
                'City': 'Business City',
                'State': 'BC',
                'Country': 'Country',
                'Postal Code': '12345',
                'Products': 'Product 1, Product 2, Product 3',
                'Minimum Order': '100',
                'Payment Terms': 'Net 30',
                'Shipping Terms': 'FOB',
                'Certifications': 'ISO 9001, CE',
                'Notes': 'Additional notes about the supplier'
            }
        ];
        
        const ws = XLSX.utils.json_to_sheet(templateData);
        
        // Definir larguras das colunas
        const colWidths = [
            { wch: 25 }, // Company Name
            { wch: 30 }, // Website
            { wch: 15 }, // Category
            { wch: 15 }, // Account Status
            { wch: 12 }, // Date
            { wch: 15 }, // Manager
            { wch: 20 }, // Status
            { wch: 30 }, // Description
            { wch: 20 }, // Contact Name
            { wch: 25 }, // Contact Email
            { wch: 15 }, // Contact Phone
            { wch: 20 }, // Contact Position
            { wch: 25 }, // Address
            { wch: 15 }, // City
            { wch: 10 }, // State
            { wch: 15 }, // Country
            { wch: 12 }, // Postal Code
            { wch: 30 }, // Products
            { wch: 15 }, // Minimum Order
            { wch: 15 }, // Payment Terms
            { wch: 15 }, // Shipping Terms
            { wch: 20 }, // Certifications
            { wch: 30 }  // Notes
        ];
        
        ws['!cols'] = colWidths;
        
        XLSX.utils.book_append_sheet(wb, ws, 'Suppliers Template');
        
        // Gerar buffer do arquivo
        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        
        // Configurar headers para download
        res.setHeader('Content-Disposition', 'attachment; filename="suppliers_template.xlsx"');
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        res.send(buffer);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ success: false, message: 'Error generating template file' });
    }
});

// Rota para upload em lote de fornecedores
app.post('/bulk-upload', requireAuth, requireManagerOrAdmin, upload.single('excelFile'), async (req, res) => {
    try {
<<<<<<< HEAD
        const selectedCountry = req.session.selectedCountry || (req.session.user?.allowedCountries?.[0] || 'US');
=======
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        
        // Ler o arquivo Excel do buffer
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        
        // Converter para JSON
        const jsonData = XLSX.utils.sheet_to_json(worksheet);
        
        if (jsonData.length === 0) {
            return res.status(400).json({ success: false, message: 'Excel file is empty or invalid format' });
        }
        
        // Ler dados existentes da planilha
        let existingData = [];
        try {
<<<<<<< HEAD
            existingData = await readExcelData(selectedCountry);
=======
            existingData = await readExcelData();
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        } catch (error) {
            console.log('No existing data found, starting with empty array');
        }
        
        let recordsAdded = 0;
        const errors = [];
        
        // Processar cada linha do Excel
        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            
            try {
<<<<<<< HEAD
                // Mapear campos do Excel para o formato da planilha oficial
                const STATUS_HEADER = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';
                const record = {
                    'Name': row['Name'] || row['Company Name'] || '',
                    'Website': row['Website'] || '',
                    'CATEGORÍA': row['CATEGORÍA'] || row['Category'] || '',
                    'Account Request Status': row['Account Request Status'] || row['Account Status'] || '',
                    'DATE': row['DATE'] || row['Date'] || '',
                    'Responsable': row['Responsable'] || row['Manager'] || '',
                    [STATUS_HEADER]: row[STATUS_HEADER] || row['Status'] || '',
                    'Description/Notes': row['Description/Notes'] || row['Description'] || '',
                    'Contact Name': row['Contact Name'] || '',
                    'Contact Phone': row['Contact Phone'] || '',
                    'E-Mail': row['E-Mail'] || row['Contact Email'] || '',
                    'Address': row['Address'] || '',
                    'User': row['User'] || '',
                    'PASSWORD': row['PASSWORD'] || '',
                    'LLAMAR': row['LLAMAR'] || '',
                    'PRIO (1 - TOP, 5 - bajo)': row['PRIO (1 - TOP, 5 - bajo)'] || row['Priority'] || '',
                    'Comments': row['Comments'] || '',
                    'Country': selectedCountry,
                    'Created_By_User_ID': req.session.user.id,
                    'Created_By_User_Name': req.session.user.name,
                    'Created_At': new Date().toISOString()
                };
                
                // Validar campos obrigatórios
                if (!record['Name'] || !record['CATEGORÍA']) {
                    errors.push(`Row ${i + 2}: Name and CATEGORÍA are required`);
                    continue;
                }
                
=======
                // Mapear campos do Excel para o formato interno
                const record = {
                    name: row['Company Name'] || '',
                    website: row['Website'] || '',
                    categoria: row['Category'] || '',
                    accountStatus: row['Account Status'] || '',
                    date: row['Date'] || '',
                    responsable: row['Manager'] || '',
                    status: row['Status'] || '',
                    description: row['Description'] || '',
                    contactName: row['Contact Name'] || '',
                    contactEmail: row['Contact Email'] || '',
                    contactPhone: row['Contact Phone'] || '',
                    contactPosition: row['Contact Position'] || '',
                    address: row['Address'] || '',
                    city: row['City'] || '',
                    state: row['State'] || '',
                    country: row['Country'] || '',
                    postalCode: row['Postal Code'] || '',
                    products: row['Products'] || '',
                    minimumOrder: row['Minimum Order'] || '',
                    paymentTerms: row['Payment Terms'] || '',
                    shippingTerms: row['Shipping Terms'] || '',
                    certifications: row['Certifications'] || '',
                    notes: row['Notes'] || ''
                };
                
                // Validar campos obrigatórios
                if (!record.name || !record.categoria) {
                    errors.push(`Row ${i + 2}: Company Name and Category are required`);
                    continue;
                }
                
                // Adicionar timestamp e ID
                record.id = Date.now() + Math.random();
                record.createdAt = new Date().toISOString();
                record.createdBy = req.session.user.name;
                
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
                existingData.push(record);
                recordsAdded++;
                
            } catch (error) {
                errors.push(`Row ${i + 2}: ${error.message}`);
            }
        }
        
        // Salvar dados atualizados
        if (recordsAdded > 0) {
            try {
<<<<<<< HEAD
                await writeExcelData(existingData, selectedCountry);
=======
                await writeExcelData(existingData);
                
                // Log da atividade de upload em lote
                const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
                auditLogger.logActivity('BULK_UPLOAD', req.session.user.email, 'Supplier/Distributor', 
                    `${recordsAdded} registros adicionados via upload Excel`, clientIP);
                
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
            } catch (error) {
                console.error('Error writing to Excel:', error);
                return res.status(500).json({ 
                    success: false, 
                    message: 'Error saving data to spreadsheet' 
                });
            }
        }
        
        // Resposta com resultado
        const response = {
            success: true,
            recordsAdded: recordsAdded,
            message: `Successfully processed ${recordsAdded} records`
        };
        
        if (errors.length > 0) {
            response.warnings = errors;
            response.message += `. ${errors.length} rows had errors and were skipped.`;
        }
        
        res.json(response);
        
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
<<<<<<< HEAD
        // Em produção, verificar se Google Drive está configurado
        if (NODE_ENV === 'production') {
            if (process.env.GOOGLE_DRIVE_FILE_ID) {
                console.log('🔄 Verificando conexão com Google Drive...');
                try {
                    await googleDriveService.refreshCache();
                    console.log('✅ Google Drive configurado com sucesso!');
                } catch (error) {
                    console.warn('⚠️ Aviso: Erro ao conectar com Google Drive:', error.message);
                }
            } else {
                console.warn('⚠️ GOOGLE_DRIVE_FILE_ID não configurado. Usando modo local.');
            }
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
=======
        // Inicializar banco de dados se estiver em produção
        if (NODE_ENV === 'production' && process.env.DATABASE_URL) {
            console.log('🔄 Inicializando banco de dados PostgreSQL...');
            await initializeDatabase();
            console.log('✅ Banco de dados inicializado com sucesso!');
        }
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`🚀 Servidor LOKOK rodando na porta ${PORT}`);
            console.log(`📊 Ambiente: ${NODE_ENV}`);
            
            if (NODE_ENV === 'development') {
                console.log(`\n🌐 Acesse: http://localhost:${PORT}`);
                console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
                console.log('\n👤 Usuários de teste:');
                console.log('Admin: hubert / admin123');
                console.log('Gerente: nacho / gerente123');
            } else {
                console.log('\n👤 Usuários padrão criados:');
                console.log('Admin: hubert / admin123');
                console.log('Gerente: nacho / gerente123');
            }
        });
    } catch (error) {
        console.error('❌ Error initializing server:', error);
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
        process.exit(1);
    }
}

// Iniciar servidor
<<<<<<< HEAD
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
        const country = normalizeCountryCode(raw);
        const allowed = normalizeAllowedCountries(req.session.user?.allowedCountries || []);
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
=======
startServer();
>>>>>>> ceba69d (Initial commit - Sistema LOKOK)
