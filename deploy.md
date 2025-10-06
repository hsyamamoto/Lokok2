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
SESSION_SECRET=lokok-railway-secret-2024-super-secure
EXCEL_PATH=./data/Wholesale Suppliers and Product Opportunities.xlsx
```

**Nota**: `DATABASE_URL` será configurada automaticamente pelo Railway.

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