# 🚀 Guia de Deploy no Railway - LOKOK

## ✅ Preparação Concluída

O sistema LOKOK já está preparado para deploy no Railway com as seguintes configurações:

- ✅ Variáveis de ambiente configuradas
- ✅ Porta dinâmica implementada
- ✅ Arquivo `railway.json` criado
- ✅ Banco PostgreSQL configurado
- ✅ Migração automática de dados implementada
- ✅ Scripts de produção no `package.json`
- ✅ Arquivo `.env.example` documentado
- ✅ `.gitignore` configurado
- ✅ Dados Excel organizados na pasta `data/`

## 💾 Persistência de Usuários (Railway)

Para evitar perda de senhas e permissões a cada deploy, configure armazenamento persistente para `users.json`:

- Crie um Volume no Railway e monte em `/data` (Service → Storage/Volumes → Add Volume → Mount Path `/data`).
- Defina a variável de ambiente `DATA_DIR=/data` no serviço.
- Defina `NODE_ENV=production`.
- (Opcional) Evite seed de usuários padrão em produção:
  - Não defina `ALLOW_DEFAULT_USERS_SEED` (ou defina como `false`).
  - Configure um admin via variáveis de ambiente para garantir acesso:
    - `SEED_ADMIN_EMAIL=<email>`
    - `SEED_ADMIN_PASSWORD=<senha>`
    - `SEED_ADMIN_NAME=<nome>` (opcional)
    - `SEED_ADMIN_ALLOWED_COUNTRIES=US,CA,MX` (opcional)

Com essas configurações, se `users.json` não existir, o app criará o arquivo no Volume sem semear usuários de teste. Se as variáveis `SEED_ADMIN_*` estiverem definidas, um único admin será criado automaticamente.

Endpoint de diagnóstico: `GET /health` — verifique `usersFilePath` (deve apontar para `/data/users.json`) e `roleCounts`.

## 🔧 Próximos Passos

### 1. Instalar Git (se necessário)
```bash
# Baixar e instalar Git do site oficial
# https://git-scm.com/download/windows

# Ou via winget
winget install Git.Git
```

### 2. Configurar Git (primeira vez)
```bash
git config --global user.name "Seu Nome"
git config --global user.email "seu.email@exemplo.com"
```

### 3. Inicializar Repositório
```bash
git init
git add .
git commit -m "Initial commit - LOKOK system ready for Railway"
```

### 4. Criar Repositório no GitHub
1. Acesse: https://github.com/new
2. Nome do repositório: `lokok-system`
3. Deixe público
4. **NÃO** marque "Initialize with README"
5. Clique em "Create repository"

### 5. Conectar ao GitHub
```bash
git remote add origin https://github.com/SEU_USUARIO/lokok-system.git
git branch -M main
git push -u origin main
```

### 6. Deploy no Railway

#### A. Criar Conta e Projeto
1. Acesse: https://railway.app
2. Faça login com GitHub
3. Clique em "New Project"
4. Selecione "Deploy from GitHub repo"
5. Escolha o repositório `lokok-system`
6. Railway detectará automaticamente Node.js

#### B. Adicionar Banco PostgreSQL
1. No dashboard do projeto, clique em "+ New"
2. Selecione "Database" → "PostgreSQL"
3. Aguarde a criação (alguns minutos)

#### C. Configurar Variáveis de Ambiente
No Railway, vá em **Settings** → **Variables** e adicione:

```
NODE_ENV=production
SESSION_SECRET=um-segredo-forte-aqui
DEFAULT_ADMIN_ALLOWED_COUNTRIES=US,CA,MX

# Para usar o Google Drive (arquivo público):
FORCE_LOCAL_EXCEL=0
GOOGLE_DRIVE_FILE_ID=1MTS0GlaxQdCPeAZZfwZvtbCjbQ_wFmXl

# Fallback/local
EXCEL_PATH=./data/lokok2-export-US-20251119.xlsx
```

Se o arquivo do Drive for privado, adicione também:

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\n...sua-chave...\n-----END PRIVATE KEY-----\n
# Nesse caso, mantenha FORCE_LOCAL_EXCEL=0
```

**Notas**:
- `DATABASE_URL` será configurada automaticamente pelo Railway se você adicionar PostgreSQL.
- Com `GOOGLE_DRIVE_FILE_ID` público, não é necessário conta de serviço.
- Para paridade exata usando Excel local no deploy via GitHub Actions, defina o secret `EXCEL_DOWNLOAD_URL` apontando para um link de download direto da planilha. O workflow fará o download para `./data/lokok2-export-US-20251119.xlsx` antes do deploy.

#### D. Deploy Automático
- O Railway fará o deploy automaticamente
- Aguarde alguns minutos para conclusão
- Verifique os logs em "Deployments"

### 7. Primeira Execução

1. **Acesse a URL** fornecida pelo Railway
2. **Aguarde a inicialização** (primeira vez pode demorar)
3. **Verifique os logs** se houver problemas
4. **Faça login** com:
   - **Admin**: `hubert` / `admin123`
   - **Gerente**: `nacho` / `gerente123`

## 🔍 Verificações Pós-Deploy

### ✅ Checklist de Funcionamento
- [ ] Site carrega sem erros
- [ ] Login funciona
- [ ] Dashboard exibe dados
- [ ] Busca funciona
- [ ] Edição funciona (para usuários autorizados)
- [ ] Dados foram migrados do Excel

### 🐛 Solução de Problemas

#### Erro de Conexão com Banco
- Verifique se o PostgreSQL foi criado
- Confirme se `DATABASE_URL` está configurada
- Verifique logs de deploy

#### Erro de Migração de Dados
- Confirme se o arquivo Excel está na pasta `data/`
- Verifique se `EXCEL_PATH` está correto
- Consulte logs da aplicação

#### Site não carrega
- Verifique se o deploy foi concluído
- Confirme se não há erros nos logs
- Teste a URL fornecida pelo Railway

## 🔄 Atualizações Futuras

Para atualizar o sistema:

```bash
# Fazer alterações no código
git add .
git commit -m "Descrição das alterações"
git push
```

O Railway fará o redeploy automaticamente.

## 📊 Monitoramento

- **Logs**: Railway Dashboard → Deployments → View Logs
- **Métricas**: Railway Dashboard → Metrics
- **Banco**: Railway Dashboard → PostgreSQL → Connect

## 🎉 Sucesso!

Se tudo funcionou:
- ✅ Sistema LOKOK está online
- ✅ Dados migrados para PostgreSQL
- ✅ Usuários podem fazer login
- ✅ Funcionalidades operacionais

**URL do Sistema**: `https://seu-projeto.railway.app`

---

**Desenvolvido para LOKOK** 🚀

*Qualquer dúvida, consulte os logs do Railway ou este guia.*
 
---

## 🔁 Paridade Local/Produção (Railway)

Para garantir que o ambiente de produção espelhe exatamente seu ambiente local:

- Root Directory: use a raiz do repositório (onde estão `package.json` e `server.js`).
- Start Command: `npm start`.
- Health Check: configure `GET /health` nas configurações do serviço.
- Variáveis de ambiente (Railway → Variables):
  - `NODE_ENV=production`
  - `SESSION_SECRET` com valor seguro
  - `DEFAULT_ADMIN_ALLOWED_COUNTRIES=US,CA,MX`
  - Para Drive público: `FORCE_LOCAL_EXCEL=0` + `GOOGLE_DRIVE_FILE_ID=<ID>`
  - Para arquivo privado no Drive: `FORCE_LOCAL_EXCEL=0` + `GOOGLE_DRIVE_FILE_ID` + `GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_PRIVATE_KEY`
  - Fallback local: `EXCEL_PATH=./data/cached_spreadsheet.xlsx`
  - (Opcional) `DATABASE_URL` se usar PostgreSQL

### Validação de Paridade
- Acesse `/health` e confirme `200 OK`.
- Acesse `/version` para ver commit/branch em produção.
- Teste `/` e `/login` — devem responder com `200` assim como no local.

Observação: o arquivo `data/cached_spreadsheet.xlsx` está no repositório para garantir a mesma base de dados entre local e produção quando `FORCE_LOCAL_EXCEL=1`. Quando `FORCE_LOCAL_EXCEL=0` e `GOOGLE_DRIVE_FILE_ID` está definido, a aplicação baixa e faz cache automático.
## Deploy (Railway) e Suporte a Países

Este projeto suporta múltiplos países nas abas do Excel: `Wholesale LOKOK` (US), `Wholesale CANADA`, `Wholesale MEXICO`. O servidor valida e filtra dados com aliases (`US/USA/UNITED STATES`, `CA/CANADA`, `MX/MEXICO`).

### Variáveis de Ambiente Necessárias

Configure as variáveis no Railway ou no arquivo `.env.production`:

- `PORT`: porta do servidor (ex.: `3000`).
- `NODE_ENV`: `production` em produção.
- `SESSION_SECRET`: segredo forte para sessão.
- `GOOGLE_DRIVE_FILE_ID`: ID do arquivo no Google Drive (pode ser público; ativa download/caching do Excel). Se público, não precisa de conta de serviço.
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`: e-mail da service account (necessário para arquivos privados).
- `GOOGLE_PRIVATE_KEY`: chave privada da service account (use `\n` para quebras de linha, necessário para arquivos privados).
- `EXCEL_PATH`: caminho do Excel local de fallback (se Google Drive não estiver configurado) — por padrão `./data/lokok2-export-US-20251119.xlsx`.
- (Actions) `EXCEL_DOWNLOAD_URL`: URL direta da planilha para baixar no runner e incluir no deploy.
- `DEFAULT_ADMIN_ALLOWED_COUNTRIES`: valores padrão permitidos para admin, ex.: `US,CA,MX`.

Veja exemplos em `.env.production.example`.

### Planilha do Google Drive

Recomendado:
- Garantir que existam abas por país: `Wholesale LOKOK`, `Wholesale CANADA`, `Wholesale MEXICO`.
- Alternativamente, incluir coluna `Country` com valores consistentes (ex.: `US`, `CA`, `MX`).

O servidor cria abas quando faltam (no cache local). Para escrita no Google Drive, o serviço salva na aba correspondente ao país quando configurado (US/CA/MX). Em arquivos públicos, apenas leitura é garantida; escrita requer permissões (arquivo compartilhado com a service account como Editor).

### Passos de Validação

1. Defina `DEFAULT_ADMIN_ALLOWED_COUNTRIES=US,CA,MX` e garanta que usuários admin possuam `allowedCountries` coerentes no `users.json`.
2. Suba o servidor (`NODE_ENV=production`). Se `GOOGLE_DRIVE_FILE_ID` não estiver configurado, usará `EXCEL_PATH` local.
3. Faça login como admin, troque entre `US`, `CA` e `MX` em `/switch-country` e valide que o dashboard e a busca refletem dados da aba/país correto.
4. Caso utilize Google Drive, valide o download do Excel e a leitura das abas país.

### Observações

- A rota `/search` e `/edit/:id` foram ajustadas para respeitar `selectedCountry` ao ler e salvar.
- Caso precise de escrita diferenciada por aba no Google Drive, considere estender `googleDriveService.saveSpreadsheetData` para aceitar a aba destino.
