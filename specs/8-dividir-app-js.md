# #8 · B-06 · Dividir o app.js em módulos (tamanho G)

## Objetivo

O `js/app.js` tem 2.581 linhas num único bloco. A Jéssica quer o código separado por assunto (armazenamento, períodos, cofre, cartões, cupom, pagamento dividido, backup, telas, atualização), para mexer num assunto sem medo de quebrar os outros. **Para quem usa o app nada muda**: mesmas telas, mesmos dados, mesmo funcionamento sem internet. Sem etapa de montagem (sem build).

## Situação atual (levantada no código)

- `js/app.js` é uma função autoexecutável `(() => { "use strict"; ... })()` com tudo dentro: utilidades, regras, IndexedDB (`IDB`, `Store`), cofre, ~60 funções de tela e um único objeto de estado `S` (linhas 265–269) lido e escrito em ~224 pontos.
- Os outros arquivos de `js/` (`issuers`, `match`, `recorte`, `receipt`, `gemini`, `drive`, `csv`, `graficos`, `credito`) são **scripts clássicos** que se penduram em `window` (`window.Match = {...}`). `index.html` os carrega com `<script defer>` na ordem; `app.js` é o último.
- `tests/carregar.js` lê esses arquivos e executa com `vm.runInThisContext` (com `window = globalThis`). **Nenhum teste carrega `app.js`**; o código de tela não é testável hoje.
- `sw.js` tem a lista `FILES` (cache offline) e faz `importScripts("js/credito.js")`.
- `scripts/versao.mjs` procura `const APP_VERSION = "..."` **dentro de `js/app.js`**.
- Há dependência circular natural: `render()` chama as telas, e as telas/ações chamam `render()`, `run()`, `toast()`.

## Decisão de desenho (recomendada)

1. **Módulos ES só para o que sai de `app.js`**, carregados por uma única tag `<script type="module" src="js/app.js">` (o `app.js` vira a porta de entrada pequena: importa os módulos, liga os eventos e inicia). Módulos ES já são adiados por padrão, então a ordem com os scripts clássicos `defer` continua: os `window.Match`, `window.Issuers` etc. existem antes do módulo rodar.
2. **Os 9 scripts clássicos existentes não mudam** (nem viram módulos), logo `tests/carregar.js` e `sw.js` (`importScripts("js/credito.js")`) continuam funcionando sem alteração. Dentro dos módulos novos eles seguem sendo usados como globais (`Match`, `Credito`...).
3. **Estado `S`:** continua sendo **um único objeto**, com o mesmo formato e os mesmos nomes de campo, criado em `js/app/estado.js` e exportado (`export const S`). Todos os módulos importam o mesmo objeto e mexem nele como hoje (`S.cards`, `S.txs`...). Não trocar por store/eventos/classes: seria mudança de comportamento, não de organização.
4. **Ciclos (render ↔ telas):** permitidos **somente entre módulos de tela/ação**, usando `function` declarada e chamada só em tempo de execução (nunca no momento do import), o que ES modules suportam. Módulos "de baixo" (`util`, `estado`, `armazenamento`, `periodos`, `cripto`) **só importam outros módulos de baixo**. *(Ajuste do arquiteto:)* com a criptografia separada em `cripto.js` e `touchVault`/`lockVault`/`decryptCards` indo para `cofre.js` (módulo de tela), **nenhum módulo de baixo precisa chamar `render`**; o `gancho` da versão anterior desta spec **não é necessário** e não deve ser criado.
5. **Pasta:** `js/app/*.js` para os módulos novos; `js/app.js` fica como entrada e **mantém `const APP_VERSION`** (é onde `versao.mjs` procura; não mexer no script de versão).

## Mapeamento dos blocos atuais para os módulos

(linhas reais do `js/app.js` em `dev` em 24/10/2026, versão 1.11.0, 2.581 linhas; conferidas pelo arquiteto. Base = só importa base.)

| Módulo novo | Camada | Linhas atuais | O que vai |
|---|---|---|---|
| `js/app/util.js` | base | 3–18, 22–49, 270–282, 576–585 | `TYPES`, `ISSUERS`, `ISSUER_STYLE`, `issuerStyle`, `fold`, `MANY`, `CATS`, `MONTHS`, `brl`, `esc`, `uid`, `pad`, `isoDay`, `monthKey`, `todayISO`, `midnight`, `mkDate`, `shortDate`, `parseMoney`, `fmtInput`, `fmtDay`, `delta`, `$`, `toast`, `explain`, `svg`, `ICON`. Não importa nada. (A linha 19 `APP_VERSION` fica na entrada; 20 `LOCK_MS` vai para `cofre.js`; 21 `BACKUP_VERSION` vai para `backup.js`.) |
| `js/app/estado.js` | base | 264–269, 283–288 + novos | `S`, `cardById`, `sortedCards`, `visibleCards`, `holders`, `txSort`, `lastTxDate`; e os dois objetos novos `ui` e `config` (ver "Desenho"). Não importa nada. |
| `js/app/armazenamento.js` | base | 191–262, 323–325 | `DB_NAME`, `OLD_DB_NAME`, `IDB`, `migrateOldDb`, `Store`, `upsert`, `askPersist`. Importa `estado`. |
| `js/app/periodos.js` | base | 51–172 | `dayModeOf`, `amountModeOf`, `fromISO`, `addDays`, `isBenefitCredit`, `benefitCredits`, `creditDates`, `expectedAmount`, `estimateNext`, `periodAt`, `periodShift`, `periodLabel`, `workdaysBetween`, `periodStats`, `creditInfo`, `perDayOf`, `creditWhen`. Importa `util`, `estado`. |
| `js/app/cripto.js` | base | 173–190 | `b64`, `unb64`, `hasCrypto`, `deriveKey`, `seal`, `unseal`. Não importa nada. |
| `js/app/folhas.js` | tela | 1247–1286, 1299–1377, 1520–1528 | `hist`, `whenHistoryIdle`, `goBack`, `openSheet`, `closeSheet`, `catButtons`, `wireCats`, `defaultCardId`, `txSheet`, `confirmSheet`. **Sem** os dois `addEventListener` das linhas 1287–1298 (vão para a entrada). `let sheetCleanup` (1248) deixa de existir: vira `ui.sheetCleanup`. |
| `js/app/telas.js` | tela | 290–315, 352–392, 586–632, 648–662, 686–755, 906–937, 1125–1154, 2410–2413 | `run`, `postTxs`, `deleteTx`, `renderTop`, `render`, `reduceMotion`, `navigate`, `periodoDeCartao`, `renderGraficos`, `renderExtrato`, `extratoFiltrado`, `renderTxArea`, `renderAjustes`, tema (`THEMES`, `THEME_HINT`, `themeNow`, `applyTheme`, `themeSheet`), `actionSheet`, `goTab`, `renderTxList`, `openCard` (sai da região de eventos porque `cardSheet` o chama). |
| `js/app/inicio.js` | tela | 393–575, 999–1057 | `pendingCredits`, `renderNotices`, `creditDateFor`, `creditSheet`, `registerCredit`, `previstos`, `previstosHoje`, `renderPrevistos`, aviso por notificação (`syncAgenda`, `avisoSuportado`, `avisoLigar`, `avisoDesligar`, `renderAvisoCredito`), `renderHome`, `renderCreditNotices`, `creditBatchSheet`. |
| `js/app/cofre.js` | tela | 20, 327–351, 663–685, 1155–1177, 1529–1652 | `LOCK_MS`, `touchVault`, `lockVault`, `decryptCards`, `renderCofre`, `renderSecrets`, `vaultSheet`, `secretsSheet`, `changeMasterSheet`. |
| `js/app/cartoes.js` | tela | 316–322, 876–898, 938–998, 1058–1124, 1178–1246, 1378–1519 | `deleteCard`, `readCardImage`, `layoutNow`, `renderCardToolbar`, `matchesQuery`, `groupOpen`, `renderCardArea`, `renderRow`, `pickLabel`, `cardPickerHTML`, `wirePicker`, `renderTile`, `renderCard`, `cardSheet`, `adjustSheet`. |
| `js/app/cupom.js` | tela | 899–905, 1653–1829, 2175–2185 | `warmReader`, `openCamera`, `openGallery`, `shrink`, `scanQueue`, `startScan`, `nextScan`, `scanOne`, `confirmarRecorte`, `storeKeyOf`, `rankCards`, `receiptSheet`. |
| `js/app/conferencia.js` | tela | 1954–2174 | `reviewForm` (~220 linhas; **mover inteira, sem dividir**). |
| `js/app/pagamento.js` | tela | 1830–1953 | `OTHER_KINDS`, `splitSeq` (só este módulo o altera), `splitHTML`, `wireSplit`, `checkSplit`, `savePurchase`, `dupWarning`. |
| `js/app/backup.js` | tela | 21, 633–647, 2186–2408 | `BACKUP_VERSION`, `exportarPlanilha`, `blobToDataURL`, `dataURLToBlob`, `photosSheet`, `aboutSheet`, `coletarFotos`, Drive (`driveOn`, `enviarAoDrive`, `salvarNoDrive`, `driveAutomatico`, `restaurarDoDrive`, `driveSheet`), `backupSheet`, `importFile`. |
| `js/app/atualizacao.js` | tela | 834–875 | `newerThan`, `checkUpdate`, `applyUpdate`, `renderUpdateNotice`. |
| `js/app/gemini-ui.js` | tela | 756–833 | `cleanKey`, `geminiOn`, `modelOptions`, `geminiUsageText`, `geminiSheet`. |
| `js/app.js` (entrada) | entrada | 1–2 (vira cabeçalho), 19, 1287–1298, 2409, 2414–2581 | imports, `const APP_VERSION` (linha intacta) + `config.APP_VERSION = APP_VERSION`, os listeners de `popstate`/`Escape` (1287–1298, registrados **antes** do `click`, como hoje), `toggleEye`, `installApp`, o `click` geral e demais eventos, inicialização, registro do service worker. Sem o `(() => { ... })()` (o módulo já tem escopo próprio e já é estrito). Estimativa: ~230 linhas. |

O desenvolvedor pode ajustar a fronteira de uma função entre dois módulos **de tela** vizinhos se achar um ciclo feio, **desde que não mude o comportamento** e registre no corpo do pedido. Nenhuma função de tela pode descer para um módulo de base.

## Estratégia incremental (uma etapa = um commit, cada um com `node --test` verde e o fumaça verde)

Regra: **só mover código, nunca reescrever lógica**. Nada de renomear função, "melhorar" ou corrigir bug no caminho (bug achado vira issue nova).

0. **Rede de segurança primeiro:** escrever o teste de fumaça (abaixo) e rodá-lo no `app.js` atual para provar que passa **antes** de mover qualquer coisa. Commit separado.
1. **Casca de módulo:** `index.html` passa a `<script type="module" src="js/app.js">` (sem `defer`; módulo já é adiado), `app.js` continua com todo o código. Fumaça verde. Isto prova que o app funciona como módulo (modo estrito, escopo próprio: conferir que nada dependia de variável global implícita nem de `this`).
2. **Base** (sem dependência acima): `util.js`, `estado.js` (já com `ui` e `config`), `cripto.js`, `periodos.js`, `armazenamento.js`. Sobe um por commit; `app.js` passa a importá-los. No mesmo passo nascem `tests/modulos.test.js` e `tests/estado.test.js`, e cada arquivo novo entra no `FILES` do `sw.js` **no mesmo commit** em que é criado (o teste do critério 5 já cobra isso a cada passo).
3. **Troca mecânica do estado solto** (um commit só, antes de mover qualquer tela): dentro do `app.js` ainda inteiro, `sheetCleanup` → `ui.sheetCleanup` (linhas do arquivo original 920, 1272, 1691, 1772, 2134, 2183; a declaração 1248 sai) e `APP_VERSION` → `config.APP_VERSION` nas linhas 718, 719, 723, 850, 851, 873 (a linha 19 fica). São as **únicas** reescritas permitidas na issue; o fumaça prova que nada mudou.
4. **Meio:** `gemini-ui`, `atualizacao`, `pagamento`, `folhas` (esta tirando os dois listeners 1287–1298 para a entrada, na mesma posição relativa, antes dos demais eventos).
5. **Telas e ciclos:** `cofre`, `cartoes`, `cupom`, `conferencia`, `backup`, `inicio`, `telas`. Um por commit; a cada passo o que ainda está em `app.js` importa do módulo novo e o módulo novo importa o que precisar dos outros (ciclos entre telas são normais aqui).
6. **Fechamento:** `app.js` fica só com entrada (sem a IIFE), `APP_VERSION`, eventos e inicialização; README "Estrutura do projeto" e lembrete do `CLAUDE.md` atualizados; `node scripts/versao.mjs --check` verde.

Se uma etapa quebrar o fumaça e a causa não for achada com uma correção pequena, **voltar o commit** e mover um bloco menor.

## Critérios de aceite

1. `js/app.js` fica com no máximo ~300 linhas (entrada: imports, `APP_VERSION`, eventos, inicialização, service worker) e os blocos da tabela acima vivem em `js/app/*.js`. Prova: `wc -l js/app.js` e revisão do mapeamento.
2. Não há etapa de montagem: nenhum `package.json` de build, bundler ou transpilador; `index.html` carrega o app por `<script type="module">` e abre servindo a pasta com `python -m http.server`. Prova: revisão do diff e o teste de fumaça.
3. O formato de `S` é idêntico ao atual e existe uma única instância (`export const S` em `estado.js`); nenhum módulo cria cópia do estado. Prova: teste automático novo `tests/estado.test.js` que importa `js/app/estado.js` com `import()` e confere os campos e valores iniciais de `S`.
4. Módulos de base (`util`, `estado`, `armazenamento`, `periodos`, `cripto`) só importam outros módulos de base; `util`, `estado` e `cripto` não importam nada. Prova: teste automático `tests/modulos.test.js` que lê os `import` de cada arquivo em `js/app/` e falha se um módulo de base importar qualquer arquivo fora da lista de base (lista branca, não lista negra: um módulo de tela novo fica coberto sem mexer no teste). O mesmo teste confere que nenhum arquivo de `js/app/` importa `../app.js` (a entrada).
5. **Todo arquivo de `js/app/*.js` e `js/app.js` aparece na lista `FILES` do `sw.js`** (senão o app quebra sem internet). Prova: teste automático novo em `tests/modulos.test.js` que lista `js/app/*.js` e confere um a um contra o texto de `FILES`.
6. Todo arquivo de `js/app/*.js` é carregável: o mesmo teste faz primeiro `require("./carregar.js")` (põe `Issuers`, `Match` etc. em `globalThis`, porque `util.js` e `cupom.js` leem `Issuers.NAMES`/`Match.storeKeyOf` no momento do import, como hoje) e depois importa cada um por `import(pathToFileURL(...))` no Node, **sem** `document` nem `indexedDB` definidos, e confirma que **importar não executa nada com efeito** (sem tocar em IndexedDB nem na tela; só a entrada `app.js` inicia o app). Sem `package.json`: o Node 22 do CI reconhece sozinho a sintaxe de módulo em `.js` (detecção automática); se a versão local do Node não reconhecer, o desenvolvedor registra e o teste roda no CI.
7. Os testes que já existem continuam passando sem alteração: `node --test` verde, incluindo `leitura`, `cartao`, `credito`, `gemini`, `drive`, `csv`, `graficos`, `recorte`. `tests/carregar.js` não muda (os 9 scripts clássicos continuam clássicos).
8. **Nada mudou para quem usa (fumaça em navegador):** o roteiro de fumaça (seção abaixo) dá o mesmo resultado antes e depois da refatoração, sem erro no console (`pageerror`/`console.error`) em nenhum passo.
9. Funciona sem internet: no fumaça, depois de abrir o app uma vez com o service worker ativo, recarregar com o navegador offline (`context.setOffline(true)`) abre o app e mostra os dados. Prova: passo offline do fumaça.
10. `node scripts/versao.mjs --check` continua verde (a `APP_VERSION` segue em `js/app.js`, sem mudar o script de versão) e **não se muda a versão do app nesta issue** além do que o publicador decidir ao publicar; o `VERSION` do `sw.js` deve ser alterado só na publicação, como sempre (o celular precisa baixar os arquivos novos: avisar o publicador no relatório).
11. README, seção "Estrutura do projeto", descreve a nova pasta `js/app/` e a regra "arquivo novo em `js/app/` também entra no `FILES` do `sw.js`" (também lembrada no `CLAUDE.md` já existente para `js/`).
12. Nenhum dado real em arquivo versionado: o fumaça usa só dados fictícios criados no próprio teste.

## Teste de fumaça "nada mudou" (Playwright + Chromium pré-instalado)

Ambiente: há `playwright` instalado globalmente (1.63) e Chromium em `/opt/pw-browsers` (`PLAYWRIGHT_BROWSERS_PATH` já definido). **Não adicionar Playwright ao repositório** (sem `package.json` de dependências): o script fica em `tests/local/fumaca.mjs` (a pasta `tests/local/` já é ignorada pelo git, é para uso do agente) e importa o Playwright global (`createRequire` apontando para o caminho global). O que **entra no git** são os testes de Node dos critérios 3–6, que rodam em `node --test` sem navegador. Se o Playwright não existir na máquina, o desenvolvedor registra isso e o verificador roda o fumaça no ambiente dele; não é bloqueio.

Roteiro (viewport 360×740, tema claro e depois escuro; servidor `python -m http.server 8765`; IndexedDB vazio, dados fictícios semeados pela própria tela):

1. Abrir `/`: sem erro de console; título "Ciclo" e Início vazio.
2. Criar um cartão fictício pela tela (emissor, final `0000`, titular "Teste", dia de crédito fixo) e conferir que aparece na lista.
3. Lançar um crédito e um gasto; conferir saldo exibido e a linha no extrato.
4. Abrir o cartão (tela de detalhe) e voltar com o botão Voltar do navegador.
5. Abrir as abas Extrato (incl. painel de gráficos), Cofre e Ajustes; abrir folhas (tema, backup, Drive, Gemini, sobre) e fechá-las.
6. Cofre: criar senha mestra, bloquear, desbloquear.
7. Divisão do pagamento: abrir a folha de gasto e dividir entre dois cartões fictícios; salvar.
8. Cupom: injetar um arquivo de imagem fictício em `#fileIn` (de `tests/cupons`, se houver imagem; senão só confirmar que a folha de conferência abre com texto injetado) e passar pela conferência.
9. Backup: exportar o arquivo e importá-lo de volta; conferir que os cartões voltam iguais.
10. Recarregar: os dados continuam (IndexedDB).
11. Offline: com service worker ativo, `setOffline(true)`, recarregar, o app abre e mostra os dados; nenhum `js/app/*.js` falha (`requestfailed`).
12. Captura de tela por passo, antes e depois da refatoração (`git stash`/ramo `dev` versus ramo do item), e comparação das saídas de texto (`innerText` de `#view`) de cada passo: devem ser iguais.

Os mesmos passos rodam no `app.js` antigo (etapa 0) e em cada etapa seguinte.

## Arquivos afetados

- `js/app.js`: vira a entrada (≤ ~300 linhas); mantém `const APP_VERSION`.
- `js/app/*.js` (novos, 16 arquivos conforme a tabela): o código movido.
- `index.html`: troca `<script src="js/app.js" defer>` por `<script type="module" src="js/app.js">`; os demais `<script defer>` ficam.
- `sw.js`: acrescenta cada `js/app/*.js` em `FILES`. **Não** muda `importScripts("js/credito.js")`. `VERSION` só na publicação.
- `tests/modulos.test.js`, `tests/estado.test.js` (novos): critérios 3–6.
- `tests/local/fumaca.mjs` (local, fora do git): roteiro de fumaça.
- `README.md`: seção "Estrutura do projeto".
- `CHANGELOG.md`: nada a menos que o publicador decida (mudança interna; sugestão: uma linha "Organização interna do código, sem mudança para quem usa").
- Não mudam: `js/issuers|match|recorte|receipt|gemini|drive|csv|graficos|credito.js`, `tests/carregar.js`, `scripts/versao.mjs`, `styles.css`.

## Fora do escopo

- Converter os 9 scripts clássicos existentes em módulos ES, ou trocar `window.X` por imports neles.
- Trocar o estado global `S` por outro padrão (store, eventos, framework), ou "limpar" o código.
- Bundler, TypeScript, `package.json` de build, minificação.
- Novos testes de lógica de telas além dos citados; mudar texto, visual, fluxo ou comportamento; corrigir bugs encontrados no caminho (abrir issue).
- Mudar o service worker além da lista `FILES`; mudar versão do app.

## Decisões em aberto

1. **Módulos ES para o código novo, scripts clássicos para os existentes** (vs. converter tudo para ES, vs. continuar com scripts clássicos separados por `<script>`). Recomendada: módulos ES só para `js/app/*`. Motivo: scripts clássicos separados exigiriam compartilhar o estado por globais soltos (pior), e converter tudo mexeria em `tests/carregar.js`, `sw.js` (`importScripts` não aceita módulo ES em todos os casos) e no que já tem teste. *Com padrão.*
2. **Estado:** um único `S` exportado de `estado.js`, com o mesmo formato. Alternativas: `S` em `window`; ou funções de acesso. Recomendada: exportado, sem mudar o formato. Motivo: menor risco, diff só de mover código. *Com padrão.*
3. **Ciclos entre telas:** permitidos entre módulos de tela com chamada só em tempo de execução; módulos de base só importam base (verificado por teste). Alternativa: injeção de dependência em tudo (mais código, mais risco). *Com padrão.* **Confirmada pelo arquiteto, sem `gancho`** (desnecessário depois de separar `cripto.js`).
4. **Onde fica `APP_VERSION`:** continua em `js/app.js`. Alternativa: mover para `js/app/versao.js` e ajustar `scripts/versao.mjs`. Recomendada: não mexer no script de versão (ele publica para o celular dela). *Com padrão.*
5. **Nomes e fronteiras exatos dos módulos** (ex.: dividir `telas.js` em `folhas.js` e `inicio.js`): critério do desenvolvedor, seguindo a tabela. *Com padrão.*
6. **Playwright fora do repositório** (vs. adicionar dependência de desenvolvimento). Recomendada: fora. Motivo: o projeto não tem build nem dependências; testes automáticos do repositório seguem só `node --test`. *Com padrão.*

Nenhuma decisão cai nas regras de bloqueio do `CLAUDE.md` (não mexe em `DECISOES.md`, não publica, não gasta, não apaga dados).

## Precisa de arquiteto?

**Sim.** Muda a estrutura de módulos do app (de um script único para módulos ES com `type="module"`), define como o estado compartilhado e os ciclos entre telas funcionam e a convivência com os scripts clássicos, o `sw.js` e os testes. Não muda armazenamento, formato de dados nem contrato entre sistemas. O arquiteto deve confirmar (ou corrigir) as decisões 1–3 e a tabela de fronteiras **antes** do desenvolvedor começar; se confirmar sem alteração, o desenvolvedor segue esta spec.

**Feito (24/10/2026):** decisões 1–3 confirmadas, com ajustes na tabela e na estratégia; ver a seção "Desenho" abaixo. Registrado no `DECISOES.md`. Sem bloqueio.

## Desenho (arquiteto, 24/10/2026)

### Alternativas comparadas

| | A. Módulos ES em `js/app/*.js` (escolhida) | B. Scripts clássicos separados + `window.Ciclo` | C. Tudo em módulos ES (inclusive os 9 atuais) |
|---|---|---|---|
| Custo | médio: mover código + 2 trocas mecânicas | médio-alto: todo nome compartilhado vira `Ciclo.x` (centenas de trocas) | alto: reescrever os 9 scripts, `tests/carregar.js`, todos os testes e o `importScripts` do `sw.js` |
| Risco | baixo: o diff é quase só mover; o navegador avisa import faltando | alto: esquecer um `Ciclo.` dá erro só quando a tela roda; ordem das tags vira contrato | alto: mexe no que já tem teste e no service worker (sem `type: "module"` no registro, `importScripts` não aceita ES) |
| Depois fica mais fácil | importar `periodos`/`cripto` direto em teste do Node; ver dependências pelos `import` | pouco: dependências continuam invisíveis | tudo uniforme, mas é o mesmo ganho de A com muito mais risco agora |

A é a única que deixa o diff "só mover" e torna as dependências verificáveis por teste (critério 4).

### Fatos do código que o desenho resolve

1. **Variável reatribuída de fora do módulo.** `let sheetCleanup` (1248) recebe valor em `actionSheet` (920), `scanOne` (1691, 1772), `reviewForm` (2134), `receiptSheet` (2183) e `closeSheet` (1272). Importação ES é só leitura, então isso quebraria. Solução: `estado.js` exporta `export const ui = { sheetCleanup: null };` e todos usam `ui.sheetCleanup`. `let splitSeq` (1832) só é alterado dentro de `pagamento.js`: fica como está.
2. **`APP_VERSION`** é lida por `renderAjustes` (718, 719, 723), `checkUpdate` (850, 851) e `renderUpdateNotice` (873), que saem da entrada. Um módulo não pode importar a entrada (importaria o app inteiro e iniciaria tudo no teste). Solução: `estado.js` exporta `export const config = { APP_VERSION: "" };`, a entrada mantém a linha `const APP_VERSION = "1.11.0";` (o `scripts/versao.mjs` continua achando) e logo abaixo faz `config.APP_VERSION = APP_VERSION;`. Ninguém lê a versão no momento do import, só depois que a entrada rodou.
3. **Efeitos no momento do import.** Só as linhas 1287–1298 (`popstate` e `Escape`) registram eventos fora da região de eventos. Vão para a entrada, antes do `click`, na mesma ordem de hoje.
4. **Globais dos scripts clássicos lidos no import:** `Issuers.NAMES`/`Issuers.STYLE` (11–12) e `Match.storeKeyOf` (1827). No navegador funcionam, porque scripts `defer` e módulos rodam na ordem do documento, depois da leitura da página. No teste do Node, carregar `tests/carregar.js` antes.
5. **`openCard`** (2410) é chamado por `cardSheet` (1489): sai da entrada para `telas.js`. `toggleEye` e `installApp` só são usados pela entrada e ficam nela.
6. **Nada precisa de `gancho`:** com `touchVault`/`lockVault`/`decryptCards` em `cofre.js` (tela), nenhuma função de base chama `render`, `closeSheet` ou `toast` de tela (`toast` é de `util`).

### Formato de dados

- `S`: igual, campo a campo, ao das linhas 265–269. Campos criados depois (`scanCard`, `updateAvailable`, `lastUpdateCheck`, `periodicOk`) continuam surgindo em execução, como hoje.
- Novos em `estado.js`: `ui = { sheetCleanup: null }` e `config = { APP_VERSION: "" }`. Não vão para o IndexedDB, nem para o backup ou o Drive.
- IndexedDB, backup, `meta`, `localStorage` (`ciclo-tema`): sem mudança.

### Regras de import

- Caminhos relativos com extensão (`import { S } from "./estado.js";`; na entrada, `"./app/estado.js"`). Nada de import "nu" (sem bundler).
- Só `export` nomeado; nada de `export default`.
- Código de nível superior de um módulo de tela só pode usar coisas de módulos de base ou globais clássicos (ex.: `ICON` de `util`). Nunca chamar no import uma função de outro módulo de tela.
- Nenhum módulo importa `../app.js`.

### Funções públicas

São os nomes já existentes listados na tabela, exportados com o mesmo nome. Cada módulo exporta só o que outro módulo usa; o resto fica interno. Nenhuma assinatura muda.

### Ordem de implementação

Passos 0–6 da "Estratégia incremental" acima. 7 grupos de commits, cerca de 20 commits, cada um com `node --test` e o fumaça verdes.

## Teste no celular / no PC

Só a Jéssica pode conferir (etiqueta `teste-no-celular`), depois da publicação em `dev`/antes do merge para `main`:

1. No Chrome do celular, abrir o app já instalado e ver a **atualização para a versão nova** chegar (o aviso do app) e o app abrir normal, com todos os cartões e saldos como antes.
2. Em **modo avião**, abrir o app: abre e mostra os dados (prova de que os arquivos novos entraram no cache offline).
3. Uso de um minuto: lançar um gasto, abrir um cartão, ler um cupom pela câmera (inclusive a divisão entre dois cartões), abrir Ajustes, Cofre (bloquear/desbloquear) e Backup.
4. Tema claro e escuro, tela de 360 px: nada fora do lugar.
5. Se qualquer coisa estiver diferente, ela diz na issue; o verificador compara com a captura do fumaça.

No PC: abrir `python -m http.server 8765` e passar o roteiro de fumaça manualmente também vale.
