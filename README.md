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
├── public/                        # Arquivos estáticos
├── views/                         # Templates EJS
├── server.js                      # Servidor principal
├── database.js                    # Configuração do banco
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
- **Banco**: PostgreSQL (produção)
- **Autenticação**: bcryptjs, express-session
- **Deploy**: Railway

## 📞 Suporte

Para dúvidas ou problemas:
1. Verifique os logs no Railway Dashboard
2. Confirme se todas as variáveis de ambiente estão configuradas
3. Verifique se o banco PostgreSQL está ativo

---

**Desenvolvido para LOKOK** 🚀
## Deploy via Railway v2

Este projeto está configurado com um workflow do GitHub Actions para publicar na Railway usando Token de Projeto. Siga os passos abaixo.

### Secrets necessários (GitHub → Settings → Secrets and variables → Actions)
- `RAILWAY_TOKEN`: Token de Projeto (gere no Railway dentro do projeto alvo).
- `RAILWAY_PROJECT_ID`: `046f3da1-3292-4e80-b91f-c6aa6f5d8a7b`
- `RAILWAY_SERVICE_ID`: `63a847a4-fe26-4fe1-ae1c-579713d5d340`
- Opcional: `RAILWAY_SERVICE_NAME` (se preferir apontar por nome; recomendo usar `RAILWAY_SERVICE_ID` para evitar ambiguidades).
- Observação: se você tinha `RAILWAY_API_TOKEN` (token de conta) definido, remova ou deixe vazio para evitar confusão.

### Como disparar o deploy
- Acesse `Actions` no GitHub e escolha o workflow "Deploy to Railway v2".
- Clique em "Run workflow" e selecione o branch `main`.

### O que aparecerá nos logs
- O workflow detecta Token de Projeto e pula `railway whoami` e `railway status` (diagnósticos não aplicáveis a token de projeto).
- O comando de deploy usa `railway up --detach --service <SERVICE_ID>` com o serviço configurado.
- Não deve solicitar login; o token já carrega contexto de projeto/ambiente.

### Solução de problemas
- "Unauthorized": gere um novo Token de Projeto no Railway e atualize `RAILWAY_TOKEN` nos secrets.
- "Service not found": confirme se o `RAILWAY_SERVICE_ID` é do mesmo projeto/ambiente do token. Você pode abrir direto o serviço em `https://railway.app/project/046f3da1-3292-4e80-b91f-c6aa6f5d8a7b/service/63a847a4-fe26-4fe1-ae1c-579713d5d340`.
- "Multiple services found": mantenha `RAILWAY_SERVICE_ID` preenchido ou defina `RAILWAY_SERVICE_NAME`.

### Dicas
- Prefira `RAILWAY_SERVICE_ID` quando o nome do serviço tiver espaços/símbolos.
- Tokens de Projeto geralmente já embutem o `environment`; não é necessário passar `environmentId` no deploy.
