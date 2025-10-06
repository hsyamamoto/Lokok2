const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const XLSX = require('xlsx');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { User, UserRepository } = require('./models/User');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração do middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: 'lokok-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 24 horas
}));

// Servir arquivos estáticos
app.use(express.static('public'));

// Configuração do EJS como template engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Caminho para a planilha Excel
const EXCEL_PATH = 'C:\\Users\\Hilton Yamamoto\\Downloads\\Wholesale Suppliers and Product Opportunities.xlsx';

// Instância do repositório de usuários
const userRepository = new UserRepository();

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
            res.status(403).send('Acesso negado');
        }
    };
}

// Middleware para verificar se é administrador
function requireAdmin(req, res, next) {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).send('Acesso negado - Apenas administradores');
    }
}

// Middleware para verificar se é gerente ou admin
function requireManagerOrAdmin(req, res, next) {
    if (req.session.user && ['admin', 'gerente'].includes(req.session.user.role)) {
        next();
    } else {
        res.status(403).send('Acesso negado');
    }
}

// Função para ler dados da planilha
function readExcelData() {
    try {
        const workbook = XLSX.readFile(EXCEL_PATH);
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
        console.error('Erro ao ler planilha:', error);
        return [];
    }
}

// Função para escrever dados na planilha
function writeExcelData(data) {
    try {
        const workbook = XLSX.readFile(EXCEL_PATH);
        const sheetName = workbook.SheetNames[0];
        const worksheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets[sheetName] = worksheet;
        XLSX.writeFile(workbook, EXCEL_PATH);
        return true;
    } catch (error) {
        console.error('Erro ao escrever na planilha:', error);
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
    
    if (user && User.comparePassword(password, user.password)) {
        req.session.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            name: user.name
        };
        res.redirect('/dashboard');
    } else {
        res.render('login', { error: 'Email ou senha inválidos' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// Rota principal - Dashboard
app.get('/dashboard', requireAuth, (req, res) => {
    const data = readExcelData();
    
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

app.post('/add-record', requireAuth, requireManagerOrAdmin, (req, res) => {
    const data = readExcelData();
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
        'Responsable': req.session.user.name,
        'Created_At': new Date().toISOString()
    };
    
    data.push(newRecord);
    
    if (writeExcelData(data)) {
        res.json({ success: true, message: 'Registro adicionado com sucesso!' });
    } else {
        res.json({ success: false, message: 'Erro ao adicionar registro.' });
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
            return res.json({ success: false, message: 'Email já está em uso' });
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
        console.error('Erro ao criar usuário:', error);
        res.json({ success: false, message: 'Erro interno do servidor' });
    }
});

// API para editar usuário
app.put('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const { name, email, password, role } = req.body;
        
        // Validações básicas
        if (!name || !email || !role) {
            return res.json({ success: false, message: 'Nome, email e perfil são obrigatórios' });
        }
        
        // Verificar se email já existe (exceto para o próprio usuário)
        const existingUser = userRepository.findByEmail(email);
        if (existingUser && existingUser.id !== userId) {
            return res.json({ success: false, message: 'Este email já está em uso por outro usuário' });
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
            res.json({ success: false, message: 'Usuário não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao editar usuário:', error);
        res.json({ success: false, message: 'Erro interno do servidor' });
    }
});

// API para deletar usuário
app.delete('/api/users/:id', requireAuth, requireAdmin, (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        const currentUserId = req.session.user.id;
        
        // Não permitir que admin delete a si mesmo
        if (userId === currentUserId) {
            return res.json({ success: false, message: 'Você não pode excluir sua própria conta' });
        }
        
        const success = userRepository.delete(userId);
        
        if (success) {
            res.json({ success: true, message: 'Usuário excluído com sucesso' });
        } else {
            res.json({ success: false, message: 'Usuário não encontrado' });
        }
    } catch (error) {
        console.error('Erro ao excluir usuário:', error);
        res.json({ success: false, message: 'Erro interno do servidor' });
    }
});

// Rota de busca
app.get('/search', requireAuth, (req, res) => {
    const { query, type } = req.query;
    let data = readExcelData();
    
    // Filtrar dados por usuário - só mostrar registros que eles criaram (exceto admin)
    if (req.session.user.role !== 'admin') {
        // Para usuários não-admin, filtrar por nome no campo Responsable
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

app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    console.log(`Acesse: http://localhost:${PORT}`);
    console.log('\nUsuários de teste:');
    console.log('Admin: admin@mylokok.com / admin123');
    console.log('Operador: operador@mylokok.com / operador123');
    console.log('Gerente: gerente@mylokok.com / gerente123');
    console.log('Nacho: nacho@mylokok.com / nacho123');
});