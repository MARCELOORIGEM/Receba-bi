# RECEBA BI

Dashboard operacional, financeiro e administrativo da Receba Logistica.

## Rodar local

Crie `.env` na raiz usando `.env.example` e execute:

```bash
npm install
npm start
```

Acesse `http://localhost:3000`.

## Supabase

1. Abra o SQL Editor do Supabase.
2. Execute `supabase/schema.sql`.
3. Configure no `.env` local e nas Variables da Railway:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
RECEBA_ADMIN_INITIAL_PASSWORD
```

Nunca publique `.env` nem exponha `SUPABASE_SERVICE_ROLE_KEY` no navegador.

Para criar o primeiro administrador:

```bash
npm run supabase:bootstrap
```

Administrador inicial:

```text
recebapoder2026@gmail.com
```

## Cadastros (Google Sheets)

A pagina **Dash Operacional > Cadastro > Novos cadastros** le a guia `CADASTROS`
de uma planilha do Google. A planilha precisa estar compartilhada como
"qualquer pessoa com o link pode ver".

Variaveis opcionais:

```text
CADASTROS_SHEET_ID        # id da planilha (padrao: a planilha atual de cadastros)
CADASTROS_SHEET_TAB       # nome da guia (padrao: CADASTROS)
CADASTROS_REFRESH_MINUTES # releitura automatica em minutos (padrao: 30, 0 desliga)
```

Colunas esperadas na guia: `DATA`, `ID`, `ENTREGADOR`, `CPF`, `MODAL`, `PRAÇA`,
`ORIGEM`. A cada leitura o servidor grava uma copia em
`BI/CADASTROS/_cadastros-google.csv` e usa essa copia se a planilha ficar
indisponivel. Tambem da para enviar um `.xlsx` com as mesmas colunas em
**Upload BI > Cadastros**: o arquivo entra junto com a planilha.

O cruzamento de "ultima vez que rodou" usa os relatorios operacionais e o
financeiro ja importados. Cadastro sem turno nesses relatorios aparece como
**sem registro** - nao significa que a pessoa nunca rodou, e sim que o periodo
dela nao foi importado.

## Publicar na Railway

1. Crie um projeto usando o repositorio GitHub `rafaelsilvarjs/RECEBA-BI`.
2. A Railway detecta Node.js automaticamente.
3. O arquivo `railway.json` configura `npm start`.
4. Em **Variables**, cadastre as quatro variaveis Supabase listadas acima.
5. Gere um dominio em **Settings > Networking > Generate Domain**.

O servidor usa automaticamente `process.env.PORT`.

## Volume persistente

Para manter arquivos enviados fora do GitHub, crie um Volume na Railway. O sistema reconhece `RAILWAY_VOLUME_MOUNT_PATH` e procura:

```text
<volume>/BI/
  CURITIBA/
  GOIANIA/
  RIO DE JANEIRO/
  SAO PAULO/
  FINANCEIRO/
```

Se o volume estiver vazio, o sistema usa a pasta `BI` versionada no repositorio.

Tambem e possivel definir diretamente:

```text
BI_DIR=/caminho/para/BI
```
