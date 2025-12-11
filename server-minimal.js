const express = require('express');
const session = require('express-session');
const path = require('path');
const XLSX = require('xlsx');

const app = express();
const PORT = 3000;
const EXCEL_PATH = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

// Configurações básicas
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Sessão
app.use(session({
    secret: 'lokok-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false }
}));

// Função para ler Excel
function readExcelData() {
    try {
        const workbook = XLSX.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet);
        return data;
    } catch (error) {
        console.error('Erro ao ler planilha:', error);
        return [];
    }
}

// Usuários de teste
const users = [
    { id: 1, email: 'admin@lokok.com', password: 'admin123', role: 'admin', name: 'Admin' },
    { id: 2, email: 'gerente@lokok.com', password: 'gerente123', role: 'gerente', name: 'Gerente' }
];

// Middleware de autenticação
function requireAuth(req, res, next) {
    if (req.session.user) {
        next();
    } else {
        res.redirect('/login');
    }
}

// Rotas
// Healthcheck
app.get('/health', (req, res) => {
    try {
        res.set('X-Server-File', __filename);
        res.set('X-Server-Dir', __dirname);
    } catch {}
    res.status(200).send(`OK - ${__filename}`);
});

// Version e diagnóstico rápido
const BUILD_TIME = new Date().toISOString();
app.get('/version', (req, res) => {
    let version = 'unknown';
    try {
        const pkg = require(path.join(__dirname, 'package.json'));
        version = pkg.version || version;
    } catch {}
    res.json({
        version,
        buildTime: BUILD_TIME,
        nodeEnv: process.env.NODE_ENV || 'development',
        serverDir: __dirname,
        viewsDir: app.get('views')
    });
});

// Health detalhado
app.get('/healthz', (req, res) => {
    res.json({
        status: 'OK',
        serverFile: __filename,
        serverDir: __dirname,
        viewsDir: app.get('views')
    });
});

// Quem está rodando? Rota simples para identificar o arquivo
app.get('/__whoami', (req, res) => {
    res.status(200).send(__filename);
});

// Runtime diagnóstico
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

// Debug: listar rotas registradas
app.get('/debug/routes', (req, res) => {
    try {
        const routes = [];
        const stack = app._router && app._router.stack ? app._router.stack : [];
        for (const layer of stack) {
            if (layer.route && layer.route.path) {
                const methods = Object.keys(layer.route.methods || {}).filter(Boolean);
                routes.push({ path: layer.route.path, methods });
            }
        }
        res.json({ serverFile: __filename, serverDir: __dirname, routes });
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

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
    const user = users.find(u => u.email === email && u.password === password);
    
    if (user) {
        req.session.user = user;
        res.redirect('/dashboard');
    } else {
        res.render('login', { error: 'Credenciais inválidas' });
    }
});

app.get('/dashboard', requireAuth, (req, res) => {
    console.log('Dashboard acessado por:', req.session.user.email);
    
    let data = [];
    try {
        data = readExcelData();
        console.log('Dados carregados:', data.length, 'registros');
    } catch (error) {
        console.error('Erro ao carregar dados:', error);
    }
    
    // Filtrar dados para gerentes
    let filteredData = data;
    if (req.session.user.role === 'gerente') {
        filteredData = data.filter(record => record.Created_By_User_ID === req.session.user.id);
    }
    
    const stats = {
        totalSuppliers: filteredData.length,
        categoriesStats: {}
    };
    
    res.render('dashboard', {
        user: req.session.user,
        stats: stats,
        data: filteredData
    });
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`Servidor mínimo rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
    console.log('\nUsuários de teste:');
    console.log('Admin: admin@lokok.com / admin123');
    console.log('Gerente: gerente@lokok.com / gerente123');
});
