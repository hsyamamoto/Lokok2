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
const auditLogger = require('./audit');
const GoogleDriveService = require('./googleDriveService');

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';

// Configuração do middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Caminho para a planilha Excel
const EXCEL_PATH = process.env.EXCEL_PATH || path.join(__dirname, 'data', 'Wholesale Suppliers and Product Opportunities.xlsx');

// Instância do repositório de usuários
const userRepository = new UserRepository();

// Instância do serviço Google Drive
const googleDriveService = new GoogleDriveService();

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
        return [];
    }
}

// Função para escrever dados na planilha
async function writeExcelData(data) {
    try {
        await googleDriveService.saveSpreadsheetData(data);
        return true;
    } catch (error) {
        console.error('Error writing to spreadsheet:', error);
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
    const user = userRepository.findByEmail(email);
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || '';
    
    if (user && User.comparePassword(password, user.password)) {
        req.session.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name
        };
        
        // Log de acesso bem-sucedido
        auditLogger.logAccess('LOGIN_SUCCESS', user.email, clientIP, userAgent);
        
        res.redirect('/dashboard');
    } else {
        // Log de tentativa de login falhada
        auditLogger.logAccess('LOGIN_FAILED', email || 'unknown', clientIP, userAgent);
        
        res.render('login', { error: 'Invalid email or password' });
    }
});

app.get('/logout', (req, res) => {
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
    
    const stats = {
        totalRecords: filteredData.length,
        categoryStats,
        responsibleStats,
        monthlyStats
    };
    
    res.render('dashboard', {
        user: req.session.user,
        stats,
        data: filteredData
    });
});

app.get('/form', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('form', { user: req.session.user });
});

app.get('/bulk-upload', requireAuth, requireManagerOrAdmin, (req, res) => {
    res.render('bulk-upload', { user: req.session.user });
});

app.post('/add-record', requireAuth, requireManagerOrAdmin, async (req, res) => {
    const data = await readExcelData();
    const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
    const timestamp = new Date();
    
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
        'Created_By_User_ID': req.session.user.id,
        'Created_By_User_Name': req.session.user.name,
        'Created_At': timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
        'Updated_At': '',
        'Updated_By_User_Name': '',
        'Updated_By_User_ID': ''
    };
    
    data.push(newRecord);
    
    if (await writeExcelData(data)) {
        // Log da atividade de criação
        auditLogger.logActivity('CREATE_RECORD', req.session.user.email, 'Supplier/Distributor', 
            `Nome: ${req.body.name}, Categoria: ${req.body.categoria}`, clientIP);
        
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
            role
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
            // Log da atividade de exclusão de usuário
            const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
            auditLogger.logActivity('DELETE_USER', req.session.user.email, 'User', 
                `Usuário ID ${userId} excluído`, clientIP);
            
            res.json({ success: true, message: 'User deleted successfully' });
        } else {
            res.json({ success: false, message: 'User not found' });
        }
    } catch (error) {
        console.error('Error deleting user:', error);
        res.json({ success: false, message: 'Internal server error' });
    }
});

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
            const responsible = record['Responsable'] || '';
            const isResponsible = responsible.toLowerCase().includes(userName.toLowerCase());
            return {
                ...record,
                _isResponsible: isResponsible
            };
        });
    } else if (req.session.user.role !== 'admin') {
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
    
    res.render('search', { 
        results: results, 
        query: query || '', 
        type: type || 'all',
        user: req.session.user
    });
});

// Rota GET para exibir formulário de edição
app.get('/edit/:id', requireAuth, async (req, res) => {
    const data = await readExcelData();
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
    const data = await readExcelData();
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
    
    // Atualizar timestamp de modificação
    data[recordId]['Updated_At'] = timestamp.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    data[recordId]['Updated_By_User_Name'] = user.name;
    data[recordId]['Updated_By_User_ID'] = user.id;
    
    // Salvar alterações na planilha Excel
    const saveSuccess = await writeExcelData(data);
    if (!saveSuccess) {
        return res.status(500).json({ 
            success: false, 
            message: 'Error saving changes to spreadsheet. Please try again.' 
        });
    }
    
    // Log da atividade de edição
    if (changedFields.length > 0) {
        auditLogger.logActivity('UPDATE_RECORD', user.email, 'Supplier/Distributor', 
            `ID: ${recordId}, ${changedFields.join(', ')}`, clientIP);
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
            existingData = await readExcelData();
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
                
                existingData.push(record);
                recordsAdded++;
                
            } catch (error) {
                errors.push(`Row ${i + 2}: ${error.message}`);
            }
        }
        
        // Salvar dados atualizados
        if (recordsAdded > 0) {
            try {
                await writeExcelData(existingData);
                
                // Log da atividade de upload em lote
                const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 'unknown';
                auditLogger.logActivity('BULK_UPLOAD', req.session.user.email, 'Supplier/Distributor', 
                    `${recordsAdded} registros adicionados via upload Excel`, clientIP);
                
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
        process.exit(1);
    }
}

// Iniciar servidor
startServer();