# LOKOK - Sistema de Gestão de Fornecedores

Sistema web para gerenciamento de fornecedores com autenticação e controle de acesso baseado em funções.

## 🚀 Deploy no Railway

### Pré-requisitos

1. **Instalar Git** (se não estiver instalado):
   - Baixe em: https://git-scm.com/download/windows
   - Ou use: `winget install Git.Git`

2. **Conta no Railway**:
   - Crie uma conta em: https://railway.app
   - Conecte sua conta GitHub

### Passos para Deploy

#### 1. Inicializar repositório Git
```bash
git init
git add .
git commit -m "Initial commit - LOKOK system"
```

#### 2. Criar repositório no GitHub
- Acesse https://github.com/new
- Crie um repositório público chamado `lokok-system`
- Não inicialize com README (já temos um)

#### 3. Conectar repositório local ao GitHub
```bash
git remote add origin https://github.com/SEU_USUARIO/lokok-system.git
git branch -M main
git push -u origin main
```

#### 4. Deploy no Railway
1. Acesse https://railway.app
2. Clique em "New Project"
3. Selecione "Deploy from GitHub repo"
4. Escolha o repositório `lokok-system`
5. Railway detectará automaticamente que é um projeto Node.js

#### 5. Configurar Banco PostgreSQL
1. No dashboard do projeto, clique em "+ New"
2. Selecione "Database" → "PostgreSQL"
3. Aguarde a criação do banco

#### 6. Configurar Variáveis de Ambiente
No Railway, vá em Settings → Variables e adicione:

```
NODE_ENV=production
SESSION_SECRET=lokok-railway-secret-2024
EXCEL_PATH=./data/Wholesale Suppliers and Product Opportunities.xlsx
```

**Importante**: A variável `DATABASE_URL` será configurada automaticamente pelo Railway.

#### 7. Primeira Execução
Após o deploy:
1. Acesse a URL fornecida pelo Railway
2. O sistema criará automaticamente as tabelas e usuários iniciais
3. Faça login com:
   - **Admin**: `hubert` / `admin123`
   - **Gerente**: `nacho` / `gerente123`

## 🔧 Desenvolvimento Local

### Instalação
```bash
npm install
```

### Executar em modo desenvolvimento
```bash
npm run dev
```

### Executar em modo produção
```bash
npm start
```

## 📁 Estrutura do Projeto

```
LOKOK2/
├── data/                          # Dados (Excel)
├── public/                        # Arquivos estáticos
├── views/                         # Templates EJS
├── server.js                      # Servidor principal
├── database.js                    # Configuração do banco
├── userRepository.js              # Repositório de usuários
├── package.json                   # Dependências
├── railway.json                   # Configuração Railway
├── .env.example                   # Exemplo de variáveis
└── README.md                      # Este arquivo
```

## 🔐 Usuários Padrão

| Usuário | Senha | Função |
|---------|-------|---------|
| hubert | admin123 | admin |
| nacho | gerente123 | gerente |
| marcelo | gerente123 | gerente |
| jeison | gerente123 | gerente |
| ana | gerente123 | gerente |

## 🌐 Funcionalidades

- ✅ Autenticação de usuários
- ✅ Controle de acesso por função (admin/gerente)
- ✅ Visualização de fornecedores
- ✅ Busca e filtros
- ✅ Edição de registros (com controle de permissão)
- ✅ Interface responsiva
- ✅ Migração automática de dados Excel → PostgreSQL

## 🔄 Migração de Dados

O sistema migra automaticamente os dados do Excel para PostgreSQL na primeira execução em produção. Os dados incluem:

- Informações de fornecedores
- Produtos e serviços
- Dados de contato
- Termos comerciais

## 🛠️ Tecnologias

- **Backend**: Node.js, Express.js
- **Frontend**: EJS, Bootstrap
- **Banco**: PostgreSQL (produção), Excel (desenvolvimento)
- **Autenticação**: bcryptjs, express-session
- **Deploy**: Railway

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs no Railway Dashboard
2. Confirme se todas as variáveis de ambiente estão configuradas
3. Verifique se o banco PostgreSQL está ativo

---

**Desenvolvido para LOKOK** 🚀