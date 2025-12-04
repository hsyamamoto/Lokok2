# Reversão: usar apenas Excel local no Railway

Passo a passo para voltar o ambiente ao estado anterior (sem DB/Drive):

1) Serviço Web → Settings → Variables
- Defina `USE_DB=false`.
- Defina `FORCE_LOCAL_EXCEL=1`.
- Defina `EXCEL_PATH=./data/cached_spreadsheet.xlsx`.
- Limpe `GOOGLE_DRIVE_FILE_ID` (deixe vazio).

2) Serviço Web → Deploy
- Garanta que `Start Command` esteja como `npm start`.
- Garanta `Healthcheck Path` como `/health`.
- Clique em `Redeploy`.

3) Opcional: desativar Postgres
- Se o serviço Postgres estiver vinculado e você quer impedir leitura acidental, remova temporariamente o plugin ou certifique-se de `USE_DB=false`.

4) Opcional: limpar dados JSON no banco
- Se preferir zerar qualquer resquício no banco: abra o Console/Query do Postgres e execute `TRUNCATE TABLE suppliers_json;`.
 - Alternativa via Node (no repo): `npm run clean-db -- --yes` (trunca `suppliers_json`). Para incluir `suppliers`, use `npm run clean-db -- --tables=suppliers_json,suppliers --yes`.

5) Validação
- Abra `/health` e confirme 200.
- Faça login e abra `/session-debug` para confirmar sessão.
- Abra `/dashboard` e verifique os dados da planilha cacheada.

Notas
- Os arquivos `.env.production` e `railway.json` deste repositório já estão alinhados para Excel apenas.
- As variáveis definidas no Railway têm prioridade sobre o `.env` do projeto.