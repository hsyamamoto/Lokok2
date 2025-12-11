const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const ALLOWED_COUNTRIES = ['US','CA','MX'];

// Normalização de perfis/roles para tokens consistentes (EN)
function normalizeRole(role) {
    const r = String(role || '').trim().toLowerCase();
    if (r === 'administrador') return 'admin';
    if (r === 'gerente') return 'manager';
    if (r === 'operador') return 'operator';
    if (['admin','manager','operator','user'].includes(r)) return r;
    return r || 'user';
}

class User {
    constructor(id, email, password, role, name, createdBy = null, allowedCountries = null) {
        this.id = id;
        this.email = email;
        this.password = password;
        this.role = normalizeRole(role); // normaliza PT→EN para consistência
        this.name = name;
        this.createdBy = createdBy; // ID do usuário que criou este usuário
        this.createdAt = new Date();
        this.isActive = true;
        // Países permitidos por perfil
        const normalized = Array.isArray(allowedCountries) ? allowedCountries.map(c => String(c).toUpperCase()) : null;
        const roleNorm = String(this.role || '').toLowerCase();
        const defaultCountries = (roleNorm === 'admin' || roleNorm === 'operador' || roleNorm === 'operator')
            ? ALLOWED_COUNTRIES
            : ['US'];
        this.allowedCountries = (normalized && normalized.length > 0)
            ? normalized.filter(c => ALLOWED_COUNTRIES.includes(c))
            : defaultCountries;
    }

    // Método para verificar senha
    static comparePassword(plainPassword, hashedPassword) {
        return bcrypt.compareSync(plainPassword, hashedPassword);
    }

    // Método para hash da senha
    static hashPassword(password) {
        return bcrypt.hashSync(password, 10);
    }

    // Método para verificar se é administrador
    isAdmin() {
        return this.role === 'admin';
    }

    // Método para verificar se é gerente
    isManager() {
        // Support both 'gerente' (PT) and 'manager' (EN)
        return this.role === 'gerente' || this.role === 'manager';
    }

    // Método para converter para objeto simples (sem métodos)
    toJSON() {
        return {
            id: this.id,
            email: this.email,
            password: this.password,
            role: this.role,
            name: this.name,
            createdBy: this.createdBy,
            createdAt: this.createdAt,
            isActive: this.isActive,
            allowedCountries: this.allowedCountries
        };
    }
}

// Base de dados em memória para usuários com persistência em arquivo JSON
class UserRepository {
    constructor() {
        this.users = [];
        this.nextId = 1;
        const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, '..', 'data');
        this.usersFilePath = path.join(dataDir, 'users.json');
        this.loadUsers();
    }

    // Carregar usuários do arquivo JSON
    loadUsers() {
        console.log('📂 Iniciando carregamento de usuários...');
        console.log('📍 Caminho do arquivo:', this.usersFilePath);
        
        try {
            // Criar diretório data se não existir
            const dataDir = path.dirname(this.usersFilePath);
            console.log('📁 Diretório de dados:', dataDir);
            
            if (!fs.existsSync(dataDir)) {
                console.log('🔨 Criando diretório de dados...');
                fs.mkdirSync(dataDir, { recursive: true });
            }

            if (fs.existsSync(this.usersFilePath)) {
                console.log('✅ Arquivo users.json encontrado, carregando...');
                const data = fs.readFileSync(this.usersFilePath, 'utf8');
                const userData = JSON.parse(data);
                this.users = userData.users.map(u => {
                    const user = new User(
                        u.id,
                        u.email,
                        u.password,
                        u.role,
                        u.name,
                        u.createdBy,
                        // manter compatibilidade com arquivos antigos sem allowedCountries
                        Array.isArray(u.allowedCountries) && u.allowedCountries.length > 0
                            ? u.allowedCountries
                            : ((String(u.role || '').toLowerCase() === 'admin' || ['operador','operator'].includes(String(u.role || '').toLowerCase()))
                                ? ALLOWED_COUNTRIES
                                : ['US'])
                    );
                    user.createdAt = new Date(u.createdAt);
                    user.isActive = u.isActive;
                    return user;
                });
                this.nextId = userData.nextId || 1;
                console.log(`📊 ${this.users.length} usuários carregados do arquivo`);
            } else {
                console.log('❌ Arquivo users.json não encontrado');
                const inProd = String(process.env.NODE_ENV || '').toLowerCase() === 'production';
                const allowSeed = String(process.env.ALLOW_DEFAULT_USERS_SEED || '').toLowerCase() === 'true';
                const hasEnvAdmin = !!process.env.SEED_ADMIN_EMAIL && !!process.env.SEED_ADMIN_PASSWORD;
                if (inProd && !allowSeed) {
                    console.log('🚫 Seed padrão desabilitado em produção (ALLOW_DEFAULT_USERS_SEED!=true).');
                    this.users = [];
                    this.nextId = 1;
                    if (hasEnvAdmin) {
                        console.log('🔐 Seed de admin via variáveis de ambiente habilitado.');
                        this.initializeEnvAdmin();
                    }
                    this.saveUsers();
                    console.log('💾 Arquivo users.json criado sem seed padrão.');
                } else {
                    console.log('🔧 Inicializando usuários padrão (não produção ou seed permitido)...');
                    this.initializeDefaultUsers();
                    this.saveUsers();
                    console.log('💾 Arquivo users.json criado com usuários padrão');
                }
            }
        } catch (error) {
            console.error('❌ Erro ao carregar usuários:', error);
            console.log('🔄 Fallback: inicializando usuários padrão...');
            this.initializeDefaultUsers();
            this.saveUsers();
        }
    }

    // Salvar usuários no arquivo JSON
    saveUsers() {
        try {
            const data = {
                users: this.users.map(u => u.toJSON()),
                nextId: this.nextId
            };
            fs.writeFileSync(this.usersFilePath, JSON.stringify(data, null, 2));
        } catch (error) {
            console.error('Erro ao salvar usuários:', error);
        }
    }

    // Inicializar usuários padrão (apenas se não existir arquivo)
    initializeDefaultUsers() {
        console.log('🔧 Inicializando usuários padrão...');
        // Se variáveis de ambiente para admin estiverem presentes, priorizar somente esse admin
        if (process.env.SEED_ADMIN_EMAIL && process.env.SEED_ADMIN_PASSWORD) {
            const email = process.env.SEED_ADMIN_EMAIL;
            const password = process.env.SEED_ADMIN_PASSWORD;
            const name = process.env.SEED_ADMIN_NAME || 'Admin';
            const allowed = (process.env.SEED_ADMIN_ALLOWED_COUNTRIES || 'US,CA,MX')
                .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
            console.log('🔐 Seed de admin via env detectado. Criando apenas admin informado...');
            this.users.push(new User(
                this.nextId++,
                email,
                User.hashPassword(password),
                'admin',
                name,
                null,
                allowed
            ));
            console.log(`✅ Admin ${email} criado via env.`);
            return;
        }
        
        // Usuários de teste originais
        this.users.push(new User(
            this.nextId++,
            'admin@mylokok.com',
            User.hashPassword('admin123'),
            'admin',
            'Admin'
        ));
        console.log('✅ Usuário admin@mylokok.com criado');

        this.users.push(new User(
            this.nextId++,
            'operador@mylokok.com',
            User.hashPassword('operador123'),
            'operador',
            'Operador'
        ));
        console.log('✅ Usuário operador@mylokok.com criado');

        this.users.push(new User(
            this.nextId++,
            'gerente@mylokok.com',
            User.hashPassword('gerente123'),
            'gerente',
            'Gerente'
        ));
        console.log('✅ Usuário gerente@mylokok.com criado');

        // Adicionar usuário Nacho
        this.users.push(new User(
            this.nextId++,
            'nacho@mylokok.com',
            User.hashPassword('nacho123'),
            'gerente',
            'Nacho'
        ));
        console.log('✅ Usuário nacho@mylokok.com criado');

        // Adicionar usuários de teste conforme documentação
        this.users.push(new User(
            this.nextId++,
            'hubert',
            User.hashPassword('admin123'),
            'admin',
            'Hubert'
        ));
        console.log('✅ Usuário hubert criado');

        this.users.push(new User(
            this.nextId++,
            'nacho',
            User.hashPassword('gerente123'),
            'gerente',
            'Nacho'
        ));
        console.log('✅ Usuário nacho criado');
        
        console.log(`🎯 Total de usuários criados: ${this.users.length}`);
    }

    // Inicializa admin a partir das variáveis de ambiente (usado quando seed padrão está desabilitado)
    initializeEnvAdmin() {
        const email = process.env.SEED_ADMIN_EMAIL;
        const password = process.env.SEED_ADMIN_PASSWORD;
        const name = process.env.SEED_ADMIN_NAME || 'Admin';
        const allowed = (process.env.SEED_ADMIN_ALLOWED_COUNTRIES || 'US,CA,MX')
            .split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
        this.users.push(new User(
            this.nextId++,
            email,
            User.hashPassword(password),
            'admin',
            name,
            null,
            allowed
        ));
        console.log(`✅ Admin ${email} criado via env (initializeEnvAdmin).`);
    }

    // Buscar usuário por email
    findByEmail(email) {
        return this.users.find(user => user.email === email && user.isActive);
    }

    // Buscar usuário por ID
    findById(id) {
        return this.users.find(user => user.id === id && user.isActive);
    }

    // Listar todos os usuários ativos
    findAll() {
        return this.users.filter(user => user.isActive);
    }

    // Listar usuários criados por um administrador específico
    findByCreator(creatorId) {
        return this.users.filter(user => user.createdBy === creatorId && user.isActive);
    }

    // Criar novo usuário
    create(userData) {
        const roleNorm = normalizeRole(userData.role);
        const user = new User(
            this.nextId++,
            userData.email,
            User.hashPassword(userData.password),
            roleNorm,
            userData.name,
            userData.createdBy,
            Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0 ? userData.allowedCountries : null
        );
        console.log('[USER CREATE] email=', user.email, 'role=', user.role, 'allowedCountries=', user.allowedCountries);
        this.users.push(user);
        this.saveUsers();
        return user;
    }

    // Atualizar usuário
    update(id, userData) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            const user = this.users[userIndex];
            user.name = userData.name || user.name;
            user.email = userData.email || user.email;
            if (userData.password) {
                user.password = User.hashPassword(userData.password);
            }
            if (userData.role) {
                user.role = normalizeRole(userData.role);
            }
            if (Array.isArray(userData.allowedCountries) && userData.allowedCountries.length > 0) {
                user.allowedCountries = userData.allowedCountries;
            }
            console.log('[USER UPDATE] id=', user.id, 'role=', user.role, 'allowedCountries=', user.allowedCountries);
            this.saveUsers();
            return user;
        }
        return null;
    }

    // Desativar usuário (soft delete)
    deactivate(id) {
        const user = this.findById(id);
        if (user) {
            user.isActive = false;
            this.saveUsers();
            return true;
        }
        return false;
    }

    // Deletar usuário permanentemente (hard delete)
    delete(id) {
        const userIndex = this.users.findIndex(user => user.id === id);
        if (userIndex !== -1) {
            this.users.splice(userIndex, 1);
            this.saveUsers();
            return true;
        }
        return false;
    }

    // Verificar se email já existe
    emailExists(email, excludeId = null) {
        return this.users.some(user => 
            user.email === email && 
            user.isActive && 
            (excludeId ? user.id !== excludeId : true)
        );
    }
}

module.exports = { User, UserRepository };
