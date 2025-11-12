const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { User, UserRepository } = require('./models/User');
const { pool, initializeDatabase } = require('./database');
const GoogleDriveService = require('./googleDriveService');

const app = express();
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
app.use(session({
    secret: process.env.SESSION_SECRET || 'lokok-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: NODE_ENV === 'production', 
        httpOnly: true,
        sameSite: NODE_ENV === 'production' ? 'lax' : 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 horas
    }
}));

console.log('🔧 [PRODUCTION DEBUG] Configuração de sessão:', {
    secure: NODE_ENV === 'production',
    httpOnly: true,
    sameSite: NODE_ENV === 'production' ? 'lax' : 'lax',
    trustProxy: NODE_ENV === 'production'
});

// Servir arquivos estáticos
app.use(express.static('public'));

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Configuração da planilha (local ou Google Drive)
let EXCEL_PATH;
let googleDriveService;
// Flag para forçar uso de Excel local e ignorar Google Drive
const FORCE_LOCAL_EXCEL = ['1','true'].includes(String(process.env.FORCE_LOCAL_EXCEL).toLowerCase());
console.log('🔧 [PRODUCTION DEBUG] FORCE_LOCAL_EXCEL:', FORCE_LOCAL_EXCEL ? 'ENABLED' : 'DISABLED');

if (NODE_ENV === 'production' && process.env.GOOGLE_DRIVE_FILE_ID && !FORCE_LOCAL_EXCEL) {
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
    // Usar arquivo Excel local
    const candidates = [
        process.env.EXCEL_PATH,
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
        console.log('📊 [PRODUCTION DEBUG] Configurado para usar arquivo Excel local:', EXCEL_PATH, FORCE_LOCAL_EXCEL ? '(FORCED)' : '');
    } else {
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
    if (req.session.user && ['admin', 'gerente'].includes(req.session.user.role)) {
        next();
    } else {
        res.status(403).send('Access denied');
    }
}

// Função para ler dados da planilha, com suporte a país selecionado
async function readExcelData(selectedCountry = null) {
    try {
        let allData = [];
        
        if (NODE_ENV === 'production' && googleDriveService && !FORCE_LOCAL_EXCEL) {
            // Em produção, usar Google Drive
            console.log('📥 Carregando dados do Google Drive...');
            allData = await googleDriveService.readSpreadsheetData();
            // Se houver país selecionado, tentar filtrar por coluna 'Country'
            if (selectedCountry) {
                const hasCountryColumn = allData.length > 0 && Object.keys(allData[0]).some(k => k.toLowerCase() === 'country');
                if (hasCountryColumn) {
                    allData = allData.filter(r => {
                        const v = r['Country'] || r['country'] || r['COUNTRY'];
                        return (v || '').toString().toUpperCase() === selectedCountry.toUpperCase();
                    });
                }
            }
        } else {
            // Em desenvolvimento, usar arquivo local
            const workbook = XLSX.readFile(EXCEL_PATH);
            // Mapeamento de abas por país
            const countryToSheet = {
                US: 'Wholesale LOKOK',
                CA: 'Wholesale CANADA',
                MX: 'Wholesale MEXICO'
            };
            const sheets = workbook.SheetNames;
            if (selectedCountry) {
                const desiredSheet = countryToSheet[selectedCountry] || countryToSheet.US;
                if (sheets.includes(desiredSheet)) {
                    const ws = workbook.Sheets[desiredSheet];
                    const data = XLSX.utils.sheet_to_json(ws);
                    allData = allData.concat(data.map(r => ({ ...r, Country: selectedCountry })));
                } else {
                    // Fallback: se não existir a aba específica, ler todas disponíveis relevantes
                    for (const [code, tab] of Object.entries(countryToSheet)) {
                        if (sheets.includes(tab)) {
                            const ws = workbook.Sheets[tab];
                            const data = XLSX.utils.sheet_to_json(ws);
                            const inferredCountry = code;
                            allData = allData.concat(data.map(r => ({ ...r, Country: inferredCountry })));
                        }
                    }
                    // Se ainda não coletamos nada pelas abas mapeadas, fazer fallback amplo em todas as abas
                    if (allData.length === 0) {
                        for (const sheetName of sheets) {
                            const ws = workbook.Sheets[sheetName];
                            const data = XLSX.utils.sheet_to_json(ws);
                            // Heurística de país pelo nome da aba
                            const nameLc = (sheetName || '').toLowerCase();
                            let defaultCountry = 'US';
                            if (nameLc.includes('mexico')) defaultCountry = 'MX';
                            else if (nameLc.includes('canada')) defaultCountry = 'CA';
                            // Atribuir Country se não existir no registro
                            allData = allData.concat(data.map(r => {
                                const hasCountry = Object.keys(r).some(k => k.toLowerCase() === 'country');
                                const countryVal = hasCountry ? (r['Country'] || r['country'] || r['COUNTRY']) : defaultCountry;
                                return { ...r, Country: countryVal };
                            }));
                        }
                    }
                    // Filtrar pelo país desejado
                    allData = allData.filter(r => ((r.Country || '') + '').toUpperCase() === selectedCountry.toUpperCase());
                }
            } else {
                // Sem país selecionado, ler abas conhecidas e concatenar
                if (sheets.includes('Wholesale LOKOK')) {
                    const ws1 = workbook.Sheets['Wholesale LOKOK'];
                    const d1 = XLSX.utils.sheet_to_json(ws1);
                    allData = allData.concat(d1.map(r => ({ ...r, Country: 'US' })));
                }
                if (sheets.includes('Wholesale CANADA')) {
                    const ws2 = workbook.Sheets['Wholesale CANADA'];
                    const d2 = XLSX.utils.sheet_to_json(ws2);
                    allData = allData.concat(d2.map(r => ({ ...r, Country: 'CA' })));
                }
                if (sheets.includes('Wholesale MEXICO')) {
                    const ws3 = workbook.Sheets['Wholesale MEXICO'];
                    const d3 = XLSX.utils.sheet_to_json(ws3);
                    allData = allData.concat(d3.map(r => ({ ...r, Country: 'MX' })));
                }
                // Fallback: se nenhuma aba conhecida existir, carregar todas as abas e inferir país por nome
                if (allData.length === 0) {
                    for (const sheetName of sheets) {
                        const ws = workbook.Sheets[sheetName];
                        const data = XLSX.utils.sheet_to_json(ws);
                        const nameLc = (sheetName || '').toLowerCase();
                        let defaultCountry = 'US';
                        if (nameLc.includes('mexico')) defaultCountry = 'MX';
                        else if (nameLc.includes('canada')) defaultCountry = 'CA';
                        allData = allData.concat(data.map(r => {
                            const hasCountry = Object.keys(r).some(k => k.toLowerCase() === 'country');
                            const countryVal = hasCountry ? (r['Country'] || r['country'] || r['COUNTRY']) : defaultCountry;
                            return { ...r, Country: countryVal };
                        }));
                    }
                }
            }
        }
        
        console.log(`Dados carregados: ${allData.length} registros`);
        return allData;
    } catch (error) {
        console.error('Error reading spreadsheet:', error);
        return [];
    }
}

// Função para escrever dados na planilha
async function writeExcelData(data, selectedCountry = null) {
    try {
        if (NODE_ENV === 'production' && googleDriveService) {
            // Em produção, salvar no Google Drive
            console.log('💾 Salvando dados no Google Drive...');
            await googleDriveService.saveSpreadsheetData(data);
        } else {
            // Em desenvolvimento, salvar no arquivo local
            const workbook = XLSX.readFile(EXCEL_PATH);
            // Selecionar aba por país quando disponível
            const countryToSheet = {
                US: 'Wholesale LOKOK',
                CA: 'Wholesale CANADA',
                MX: 'Wholesale MEXICO'
            };
            let sheetName = workbook.SheetNames[0];
            if (selectedCountry && countryToSheet[selectedCountry]) {
                sheetName = countryToSheet[selectedCountry];
                if (!workbook.SheetNames.includes(sheetName)) {
                    workbook.SheetNames.push(sheetName);
                    workbook.Sheets[sheetName] = XLSX.utils.json_to_sheet([]);
                }
            }
            const worksheet = XLSX.utils.json_to_sheet(data);
            workbook.Sheets[sheetName] = worksheet;
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
        
        // Incluir países permitidos na sessão
        const allowedCountries = Array.isArray(user.allowedCountries) && user.allowedCountries.length > 0
            ? user.allowedCountries
            : (user.role === 'admin' ? ['US','CA','MX'] : ['US']);
        req.session.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name,
            allowedCountries
        };
        // País selecionado inicial: primeiro permitido
        req.session.selectedCountry = allowedCountries[0];
        
        console.log('[PRODUCTION DEBUG] Sessão configurada:', {
            sessionId: req.sessionID,
            userId: req.session.user.id,
            userEmail: req.session.user.email,
            userRole: req.session.user.role
        });
        
        // Salvar sessão explicitamente antes do redirect
        req.session.save((err) => {
            if (err) {
                console.error('[PRODUCTION DEBUG] Erro ao salvar sessão:', err);
                console.error('[PRODUCTION DEBUG] Stack trace:', err.stack);
                res.render('login', { error: 'Session error. Please try again.' });
            } else {
                console.log('[PRODUCTION DEBUG] Sessão salva com sucesso, redirecionando para dashboard');
                console.log('[PRODUCTION DEBUG] Redirecionando para: /dashboard');
                res.redirect('/dashboard');
            }
        });
    } else {
        console.log('[PRODUCTION DEBUG] Login falhou para:', email);
        console.log('[PRODUCTION DEBUG] Usuário existe:', !!user);
        console.log('[PRODUCTION DEBUG] Senha válida:', user ? User.comparePassword(password, user.password) : false);
        res.render('login', { error: 'Invalid email or password' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Trocar país selecionado
app.post('/switch-country', requireAuth, (req, res) => {
    try {
        const { country } = req.body || {};
        const valid = ['US','CA','MX'];
        const allowed = (req.session.user && Array.isArray(req.session.user.allowedCountries)) ? req.session.user.allowedCountries : ['US'];
        if (country && valid.includes(country) && allowed.includes(country)) {
            req.session.selectedCountry = country;
            console.log('🌎 País selecionado atualizado para:', country);
        } else {
            console.warn('⚠️ País inválido ou não permitido:', country);
        }
        const referer = req.get('Referer');
        if (referer) return res.redirect(referer);
        return res.redirect('/dashboard');
    } catch (e) {
        console.error('Erro ao trocar país:', e);
        res.redirect('/dashboard');
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
        console.log('[PRODUCTION DEBUG] Google Drive Service disponível:', !!googleDriveService);
        
        const selectedCountry = req.session.selectedCountry || (
            Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
        ) || 'US';
        const data = await readExcelData(selectedCountry);
        console.log('[PRODUCTION DEBUG] Dados carregados:', data.length, 'registros');
    
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
    
    // Prévia dos 5 últimos cadastros (ordenar por data desc, com fallback)
    const getTime = (d) => (d && d instanceof Date && !isNaN(d)) ? d.getTime() : 0;
    const recentPreviewData = [...recentFilteredData]
        .sort((a, b) => getTime(b._parsedDate) - getTime(a._parsedDate))
        .slice(0, 5);
    
    // Processar dados para estatísticas
    const categoryStats = {};
    const responsibleStats = {};
    const monthlyStats = {};
    
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
                } else {
                    // Data inválida - usar distribuição simulada
                    const currentDate = new Date();
                    const randomMonthsAgo = Math.floor(Math.random() * 12);
                    const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                    const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                    monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
                }
            } catch (e) {
                // Erro ao processar data - usar distribuição simulada
                const currentDate = new Date();
                const randomMonthsAgo = Math.floor(Math.random() * 12);
                const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
                const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
                monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
            }
        } else {
            // Sem data - usar distribuição simulada
            const currentDate = new Date();
            const randomMonthsAgo = Math.floor(Math.random() * 12);
            const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
            const monthKey = `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
            monthlyStats[monthKey] = (monthlyStats[monthKey] || 0) + 1;
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
    
    const stats = {
        totalRecords: filteredData.length,
        categoryStats,
        responsibleStats,
        monthlyStats
    };
    
    // Calcular distribuição por responsável por mês para o Top 5 Seller do mês
    const monthlyResponsibles = {};
    const getMonthKeyFromRecord = (record) => {
        const dateValue = record['DATE'];
        try {
            if (dateValue !== undefined && dateValue !== null && String(dateValue).trim() !== '') {
                if (typeof dateValue === 'number' && dateValue > 0) {
                    const date = new Date((dateValue - 25569) * 86400 * 1000);
                    if (!isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2030) {
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    }
                } else if (typeof dateValue === 'string') {
                    const date = new Date(dateValue);
                    if (!isNaN(date.getTime()) && date.getFullYear() >= 2020 && date.getFullYear() <= 2030) {
                        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    }
                }
            }
        } catch (e) {
            // Ignorar e simular mês abaixo
        }
        // Caso inválido ou ausente, simular mês como no cálculo de monthlyStats
        const currentDate = new Date();
        const randomMonthsAgo = Math.floor(Math.random() * 12);
        const simulatedDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - randomMonthsAgo, 1);
        return `${simulatedDate.getFullYear()}-${String(simulatedDate.getMonth() + 1).padStart(2, '0')}`;
    };

    filteredData.forEach(record => {
        const monthKey = getMonthKeyFromRecord(record);
        const responsible = record['Responsable'] || 'Não especificado';
        if (!monthlyResponsibles[monthKey]) monthlyResponsibles[monthKey] = {};
        monthlyResponsibles[monthKey][responsible] = (monthlyResponsibles[monthKey][responsible] || 0) + 1;
    });

    // Opções de mês e seleção atual para Top 5
    const topMonthOptions = sortedMonthlyEntries.map(([key]) => key);
    const selectedTopMonth = (req.query.topMonth && topMonthOptions.includes(req.query.topMonth))
        ? req.query.topMonth
        : (topMonthOptions[0] || '');

    // Entradas Top 5 por responsável no mês selecionado
    let topManagerEntries = [];
    if (selectedTopMonth && monthlyResponsibles[selectedTopMonth]) {
        topManagerEntries = Object.entries(monthlyResponsibles[selectedTopMonth])
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
    }
    
        console.log('[PRODUCTION DEBUG] Renderizando dashboard com stats:', {
            totalRecords: stats.totalRecords,
            categorias: Object.keys(stats.categoryStats).length,
            responsaveis: Object.keys(stats.responsibleStats).length,
            userEmail: req.session.user?.email,
            userRole: req.session.user?.role
        });
        
        res.render('dashboard', {
            user: req.session.user,
            selectedCountry,
            stats,
            data: recentFilteredData,
            recentPreviewData,
            sortedMonthlyEntries,
            monthlySort: monthlySort || 'period_desc',
            monthlyStart: monthlyStart || '',
            monthlyEnd: monthlyEnd || '',
            recentStart: recentStart || '',
            recentEnd: recentEnd || '',
            // Dados para o Top 5 Seller do mês
            topMonthOptions,
            selectedTopMonth,
            topManagerEntries
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

app.get('/form', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('form', { user: req.session.user });
});

app.get('/bulk-upload', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('bulk-upload', { user: req.session.user });
});

app.post('/add-record', requireAuth, requireManagerOrAdmin, async (req, res) => {
    const selectedCountry = req.session.selectedCountry || (
        Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
    ) || 'US';
    const data = await readExcelData(selectedCountry);
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
        'Country': selectedCountry,
        'Created_By_User_ID': req.session.user.id,
        'Created_By_User_Name': req.session.user.name,
        'Responsable': req.session.user.name,
        'Created_At': new Date().toISOString()
    };
    
    data.push(newRecord);
    
    const saveOk = await writeExcelData(data, selectedCountry);
    if (saveOk) {
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
        let { allowedCountries } = req.body;
        // Normalizar allowedCountries vindo do formulário (array de checkboxes ou string)
        if (typeof allowedCountries === 'string') {
            // Pode vir como comma-separated ou único valor
            allowedCountries = allowedCountries.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (!Array.isArray(allowedCountries)) {
            allowedCountries = undefined; // deixe o repositório aplicar defaults
        }
        if (Array.isArray(allowedCountries)) {
            allowedCountries = allowedCountries.filter(c => ['US','CA','MX'].includes(c));
            if (allowedCountries.length === 0) {
                allowedCountries = undefined;
            }
        }
        
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
            allowedCountries,
            createdBy: req.session.user.id
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
        if (typeof allowedCountries === 'string') {
            allowedCountries = allowedCountries.split(',').map(s => s.trim()).filter(Boolean);
        }
        if (!Array.isArray(allowedCountries)) {
            allowedCountries = undefined;
        }
        if (Array.isArray(allowedCountries)) {
            allowedCountries = allowedCountries.filter(c => ['US','CA','MX'].includes(c));
            if (allowedCountries.length === 0) {
                allowedCountries = undefined;
            }
        }
        
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
    const selectedCountry = req.session.selectedCountry || (
        Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
    ) || 'US';
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

    // Adicionar índice real a cada registro
    data = data.map((record, index) => ({
        ...record,
        _realIndex: index
    }));
    
    // Para gerentes, mostrar todos os distribuidores mas com campos limitados para os que não são responsáveis
    if (req.session.user.role === 'gerente') {
        // Não filtrar os dados, mas marcar quais são do usuário para controle de exibição
        const userName = req.session.user.name;
        data = data.map(record => {
            const responsible = getField(record, ['Responsable','Manager','Buyer']);
            const isResponsible = ((responsible || '') + '').toLowerCase().includes(((userName || '') + '').toLowerCase());
            return {
                ...record,
                _isResponsible: isResponsible
            };
        });
    } else if (req.session.user.role !== 'admin') {
        // Para outros usuários não-admin:
        // Se houver query OU filtros avançados (buyer/category/accountStatus/status), permitir visualizar todos os registros
        // porém com campos limitados (marcando _isResponsible), semelhante ao comportamento dos gerentes.
        const userName = req.session.user.name;
        const hasAnyFilterOrQuery = (
            (typeof req.query.query === 'string' && req.query.query.trim().length > 0) ||
            ['buyer','category','accountStatus','status'].some(
                k => typeof req.query[k] === 'string' && req.query[k].trim().length > 0
            ) ||
            (req.query.list === 'all')
        );
        if (hasAnyFilterOrQuery) {
            data = data.map(record => {
                const responsible = getField(record, ['Responsable','Manager','Buyer']);
                const isResponsible = ((responsible || '') + '').toLowerCase().includes(((userName || '') + '').toLowerCase());
                return {
                    ...record,
                    _isResponsible: isResponsible
                };
            });
        } else {
            // Sem query e sem filtro avançado, mostrar somente registros onde o usuário é responsável
            data = data.filter(record => {
                const responsible = getField(record, ['Responsable','Manager','Buyer']);
                return ((responsible || '') + '').toLowerCase().includes(((userName || '') + '').toLowerCase());
            });
        }
    }
    
    // Novos filtros: Account Status, Buyer, Category e Status + ordenação
    const { accountStatus = '', buyer = '', category = '', status = '', sortBy = '', sortDirection = 'asc', view = 'grid', list = '' } = req.query;
    console.log('[SEARCH DEBUG] Params:', { query, type, accountStatus, buyer, category, status, sortBy, sortDirection, view });

    // Normalização e getField já declarados acima no início da rota /search para evitar TDZ e duplicações.

    const fieldStatusName = 'STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)';

    const hasAdvancedFilters = [accountStatus, buyer, category, status, list === 'all' ? 'all' : ''].some(v => v && ((v + '').trim().length > 0));
    const listAllRequested = (list === 'all') || (req.query.listAll === '1');
    console.log('[SEARCH DEBUG] Role:', req.session.user.role, 'hasAdvancedFilters:', hasAdvancedFilters);

    // Resultado do termo de busca (query)
    let resultsQuery = [];
    if (query && (query + '').trim()) {
        const q = normalize(query);
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
    // Se o usuário solicitou listar todos (list=all), ignorar o termo de busca e retornar todos os registros
    if (listAllRequested) {
        // When user requests "List ALL", return all but still respect advanced filters if present
        results = resultsAdvanced;
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
        list,
        managersList,
        accountStatusList
    });
});

// Rota GET para exibir formulário de edição
app.get('/edit/:id', requireAuth, async (req, res) => {
    const selectedCountry = req.session.selectedCountry || (
        Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
    ) || 'US';
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
    const selectedCountry = req.session.selectedCountry || (
        Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
    ) || 'US';
    const data = await readExcelData(selectedCountry);
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
    
    // Atualizar apenas os campos fornecidos
    if (name !== undefined) data[recordId].Name = name;
    if (website !== undefined) data[recordId].Website = website;
    if (categoria !== undefined) data[recordId]['CATEGORÍA'] = categoria;
    if (accountRequestStatus !== undefined) data[recordId]['Account Request Status'] = accountRequestStatus;
    // Atualizar o campo de STATUS principal usado na busca e cadastro
    if (status !== undefined) {
        data[recordId]['STATUS (PENDING APPROVAL, BUYING, CHECKING, NOT COMPETITIVE, NOT INTERESTING, RED FLAG)'] = status;
    }
    // Mantém compatibilidade caso ainda usem General Status
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
    
    // Salvar alterações na planilha Excel
    const saveSuccess = await writeExcelData(data, selectedCountry);
    if (!saveSuccess) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error saving changes to spreadsheet. Please try again.' 
        });
    }
    
    res.json({ success: true, message: 'Record updated successfully!' });
});

// Rota para download do template Excel
app.get('/download-template', requireAuth, requireManagerOrAdmin, (req, res) => {
    try {
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
        
        res.send(buffer);
    } catch (error) {
        console.error('Error generating template:', error);
        res.status(500).json({ success: false, message: 'Error generating template file' });
    }
});

// Rota para upload em lote de fornecedores
app.post('/bulk-upload', requireAuth, requireManagerOrAdmin, upload.single('excelFile'), async (req, res) => {
    try {
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
            const selectedCountry = req.session.selectedCountry || (
                Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
            ) || 'US';
            existingData = await readExcelData(selectedCountry);
        } catch (error) {
            console.log('No existing data found, starting with empty array');
        }
        
        let recordsAdded = 0;
        const errors = [];
        
        // Processar cada linha do Excel
        for (let i = 0; i < jsonData.length; i++) {
            const row = jsonData[i];
            
            try {
                // Mapear campos do Excel para o formato interno
                const selectedCountry = req.session.selectedCountry || (
                    Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
                ) || 'US';
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
                    country: (row['Country'] || selectedCountry || ''),
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
                
                existingData.push(record);
                recordsAdded++;
                
            } catch (error) {
                errors.push(`Row ${i + 2}: ${error.message}`);
            }
        }
        
        // Salvar dados atualizados
        if (recordsAdded > 0) {
            try {
                const selectedCountry = req.session.selectedCountry || (
                    Array.isArray(req.session.user?.allowedCountries) && req.session.user.allowedCountries[0]
                ) || 'US';
                await writeExcelData(existingData, selectedCountry);
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
        // Em produção, verificar se Google Drive está configurado
        if (NODE_ENV === 'production' && !FORCE_LOCAL_EXCEL) {
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
            
            if (NODE_ENV === 'production' && googleDriveService && !FORCE_LOCAL_EXCEL) {
                console.log('📊 [PRODUCTION DEBUG] Fonte de dados: Google Drive');
                console.log('🌐 [PRODUCTION DEBUG] URL de produção: https://lokok2-production.up.railway.app');
            } else {
                console.log('📊 [PRODUCTION DEBUG] Fonte de dados: Arquivo Excel local', FORCE_LOCAL_EXCEL ? '(FORCED)' : '');
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

// Iniciar servidor
startServer();

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