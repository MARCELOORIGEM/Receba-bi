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

## Cadastros (a planilha dentro do sistema)

A planilha do Google virou uma pagina do sistema: **Dash Operacional > Cadastro >
Planilha de cadastros**. E uma grade igual a de uma planilha, com as colunas
`DATA`, `CIDADE`, `ID`, `ENTREGADOR`, `CPF`, `MODAL`, `PRAÇA` e `ORIGEM`. Quem
tem a permissao **cadastro** digita na celula e sai do campo: grava sozinho na
base, sem botao de salvar. A linha em branco no topo e por onde entra cadastro
novo, e o `x` no fim da linha apaga.

**Tela cheia** esconde o menu, o cabecalho e as abas: so a barra de filtros e a
grade ficam, ocupando a janela inteira. Sai pelo mesmo botao, pelo `Esc` ou
trocando de aba. Para ganhar espaco sem sair da navegacao, a seta na beirada do
menu lateral recolhe a barra para o lado e devolve os 264px dela para a tabela -
a escolha fica guardada no navegador.

Nao existe mais leitura da planilha do Google. O que a pagina le e grava e um
arquivo `cadastros.json` do proprio servidor.

Colunas da grade: `DATA`, `CIDADE`, `ID`, `ENTREGADOR`, `CPF`, `CONTATO`,
`MODAL`, `PRAÇA`, `ORIGEM` e `SITUAÇÃO` (ATIVO/INATIVO). Cadastro antigo, que veio
da planilha sem essas duas colunas, entra como **ativo** e sem contato. Telefone
com 10 ou 11 digitos e formatado sozinho como `(11) 91234-5678`; o que nao der
para reconhecer fica como foi digitado.

**Nao existe limite de linhas.** A tela desenha so a janela visivel (umas 30
linhas) mais uma folga em cima e embaixo, entao 4 mil ou 40 mil cadastros custam
o mesmo para o navegador. **Arraste a borda do cabecalho** para mudar a largura
de qualquer coluna - a escolha fica guardada no navegador.

As larguras padrao somam ~1.220px, entao a planilha cabe inteira sem rolar para o
lado a partir de 1600px de tela com o menu aberto (ou 1366px com o menu
recolhido). Em tela menor aparecem uma **barra de rolagem horizontal no topo**,
alem da de baixo, e **setas nas beiradas** que andam 260px por clique; as tres
andam juntas e somem quando nao ha coluna escondida.

**Colar da planilha** traz tudo de uma vez: seleciona as linhas no Google Sheets,
copia e cola na caixa. Aceita com ou sem o cabecalho, separado por tabulacao
(copiar/colar), ponto e virgula ou virgula (arquivo exportado). A ordem sem
cabecalho e `DATA`, `ID`, `ENTREGADOR`, `CPF`, `CONTATO`, `MODAL`, `PRAÇA`,
`ORIGEM`, `CIDADE`, `SITUAÇÃO`. Quem ja esta na base no mesmo dia e ignorado,
entao colar duas vezes nao duplica.

As outras duas abas continuam como estavam: **Indicadores de cadastro** com os
graficos e a situacao de quem rodou, e **Base de entregadores** com a base
completa.

Carga inicial: na primeira vez que o servidor sobe sem `cadastros.json`, ele le
`BI/CADASTROS/cadastros-inicial.json` (o que ja existia na planilha, tudo como
**SAO PAULO**) e grava a base. Se esse arquivo nao existir, ele tenta a ultima
copia da planilha em `BI/CADASTROS/_cadastros-google.csv`. Depois que
`cadastros.json` existe, a semente nunca mais e lida.

Onde fica o arquivo:

```text
<volume>/cadastros.json   # quando existe RAILWAY_VOLUME_MOUNT_PATH
./cadastros.json          # rodando local
```

Praca em Sao Paulo continua presa a lista fechada (Guaianases, Itaquera, Jardim
Angelica, Mooca, Paulista, Penha, Santana, Santo Amaro), para erro de digitacao
nao virar praca nova no resumo. Nas outras cidades vale o que for digitado - da
para colocar mais de uma separando por virgula.

Variavel opcional:

```text
CADASTROS_CIDADE_PADRAO   # cidade de quem chega sem cidade (padrao: SAO PAULO)
```

Tambem da para enviar um `.xlsx` em **Upload BI > Cadastros** com as mesmas
colunas. Essas linhas entram junto com a base nos indicadores, mas nao aparecem
na grade editavel: quem manda nelas e o arquivo, nao o sistema. Para traze-las
para dentro da base, use **Colar da planilha**.

O cruzamento de "ultima vez que rodou" usa os relatorios operacionais e o
financeiro ja importados. Cadastro sem turno nesses relatorios aparece como
**sem registro** - nao significa que a pessoa nunca rodou, e sim que o periodo
dela nao foi importado.

## Melhores entregadores (Resultado Diario)

**Dash Operacional > Resultado Diario** ordena os entregadores de cada cidade por
uma **nota geral**, e nao mais so por corridas finalizadas. A barra da pagina tem
tres controles: **Ordenar por** (nota geral, corridas, TSH, AR, CAA ou Overtime),
**Minimo de corridas** (piso para entrar no ranking) e **Quantidade no ranking**
(10 a 250 ou todos) - essa quantidade vale tambem para o **Baixar Excel**.

A nota, dentro de cada cidade:

```text
TSH        35%  valor direto
AR         20%  valor direto
CAA        20%  invertido - 0% e nota cheia, o pior da cidade e zero
Overtime   10%  invertido - mesma regra
Corridas   15%  fatia do maior volume da cidade
```

TSH e AR sao taxa de acerto (mediana 80% e 74% na base atual). CAA e Overtime sao
taxa de erro (mediana 0,4%, pior caso 26%): por isso entram invertidos, senao a
nota premiaria quem mais cancela e mais atrasa. Nas colunas CAA e OT dessa tela a
cor tambem segue essa leitura - verde ate 2%, amarelo ate 5%, laranja acima.

O piso de corridas existe porque, sem ele, uma unica corrida com 100% em tudo
lidera a cidade. O padrao e 10 corridas.

**Baixar Excel** gera um `.xlsx` de verdade, uma aba por cidade, com as colunas
de percentual ja formatadas como porcentagem.

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
Os arquivos gravados pelo sistema (`cadastros.json`, `promocoes.json`) tambem vao
para a raiz do volume quando ele existe.

Tambem e possivel definir diretamente:

```text
BI_DIR=/caminho/para/BI
```
