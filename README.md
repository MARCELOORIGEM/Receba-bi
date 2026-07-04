# RECEBA BI

Dashboard operacional e financeiro da Receba Logistica.

## Rodar local

```bash
npm install
npm start
```

Acesse:

```text
http://localhost:3000
```

## Publicar no Render

1. Crie um novo **Web Service** no Render usando este repositorio GitHub.
   - Nao crie como **Static Site**.
   - Se aparecer campo **Publish Directory**, o tipo esta errado. Este projeto nao usa Publish Directory.
2. O Render detecta Node.js automaticamente.
3. Use:

```bash
Build Command: npm install
Start Command: npm start
```

4. O app usa a porta automatica do Render por `process.env.PORT`.
5. O arquivo `render.yaml` ja inclui um disco persistente montado em:

```text
/var/data
```

6. Para usar arquivos Excel fora do repositorio, coloque a pasta BI dentro do disco:

```text
/var/data/BI
```

Estrutura esperada:

```text
/var/data/BI/
  CURITIBA/
  GOIANIA/
  RIO DE JANEIRO/
  SAO PAULO/
  FINANCEIRO/
```

Se `/var/data/BI` estiver vazio, o sistema usa a pasta `BI` versionada no repositorio.

## Pasta BI local

Por padrao, em ambiente local, o sistema le os arquivos Excel em:

```text
BI/
```

O financeiro deve ficar em:

```text
BI/FINANCEIRO/
```

## Variaveis opcionais

Voce pode forcar outro caminho para os arquivos BI com:

```text
BI_DIR=/caminho/para/BI
```

## Login

## Supabase e usuarios

1. Crie um projeto no Supabase.
2. Abra **SQL Editor** e execute:

```text
supabase/schema.sql
```

3. No Render, configure:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

Nunca coloque `SUPABASE_SERVICE_ROLE_KEY` no navegador ou em codigo publico.

4. Para criar o primeiro administrador, configure um `.env` local usando `.env.example` e execute:

```bash
npm run supabase:bootstrap
```

Administrador inicial:

```text
recebapoder2026@gmail.com
```

Senha inicial:

```text
RECEBA99
```

No primeiro acesso, o administrador deve criar uma nova senha. Depois ele pode usar a pagina **Usuarios** para criar contas, definir area de acesso, perfil, status e permissoes.
