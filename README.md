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
