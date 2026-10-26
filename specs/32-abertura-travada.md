# #32 App fica preso na tela de abertura

Aviso: o corpo da issue não pôde ser lido pela ferramenta do especificador (sem acesso ao MCP do GitHub nesta execução). Esta spec parte do título ("App fica preso na tela de abertura") e do código. O desenvolvedor deve ler a issue (`--comments`) e, se houver sintoma que contradiga a causa abaixo, registrar na issue antes de seguir.

## Correção da spec após ler a issue (desenvolvedor)
Pontos da issue que a spec original não cobria, agora incluídos e implementados:
- A mensagem da abertura tem **dois botões** da issue: "Tentar de novo" (recarrega) e "Atualizar os arquivos do app" (limpa só service worker e caches; nunca IndexedDB nem localStorage). O nome "Atualizar arquivos" dos critérios abaixo vale como esse segundo botão.
- `error` e `unhandledrejection` antes do app iniciar trocam a abertura na hora (sem esperar os 10 s); o `catch` da inicialização também (`window.__cicloFalha`), mantendo os botões.
- Caminho de socorro para os dados: botão "Salvar uma cópia dos dados" na abertura, que só lê o IndexedDB (prazo de 8 s) e baixa JSON no formato do backup (sem fotos). Se não conseguir ler, a mensagem diz que os dados continuam guardados.
- Reprodução (cache misto 1.12.0 para 1.14.0): não dá para reproduzir em navegador aqui; o teste `tests/abertura-travada.test.js` simula o service worker e prova que o conjunto é servido só da cópia da versão (sem ir à internet), e que arquivo ausente vira erro explícito.

## Objetivo
Quando o Ciclo não consegue abrir, a Jéssica não pode ficar olhando o anel girando para sempre. Ou o app abre, ou aparece uma mensagem clara com um botão "Atualizar arquivos" que conserta sozinho, sem tocar em cartões, extratos, fotos e senhas.

## Causa provável (lida no código)
1. **Cache misto (mais provável).** `sw.js` serve página, estilos e módulos "rede primeiro, cópia se a rede falhar", arquivo por arquivo. Com rede ruim, `index.html`/`js/app.js` novos chegam da internet e algum `js/app/*.js` cai na cópia velha (ou numa versão diferente). Como `js/app.js` é `<script type="module">` com `import` estático, um export que não existe (SyntaxError) ou um módulo que falha ao carregar impede **todo** o `app.js` de rodar. O `try/catch` e o `fecharAbertura()` nunca executam, então `#abertura` fica na tela. Só sobra o aviso de 10 s do `index.html`, que manda "fechar e abrir de novo", o que não resolve (a cópia misturada continua lá). Pior: se o arquivo falha na rede e não está na cópia, `caches.match` devolve `undefined` e `respondWith(undefined)` vira erro de rede.
2. **IndexedDB que nunca responde.** `IDB.open()` (`js/app/armazenamento.js`) só trata `onsuccess`/`onerror`; não há `onblocked` nem limite de tempo. Se o Chrome deixar a abertura pendurada (outra aba/janela do app, banco travado após fechar o Chrome à força), a promessa nunca resolve e `fecharAbertura()` nunca é chamado. O mesmo vale para `migrateOldDb()` (aguarda `indexedDB.databases()` e abre o banco antigo sem tratar `onblocked`).
3. **"Atualizar arquivos" frágil.** `applyUpdate()` (`js/app/atualizacao.js`) chama `reg.update()` e apaga todas as caches ao mesmo tempo em que o novo service worker pode estar preenchendo a dele; pode deixar o app sem cópia offline. Só roda se o app já abriu, então não ajuda quando está preso.

Regra que vale para tudo abaixo: **nunca apagar nem tocar no IndexedDB** (`ciclo`). Limpar só caches e service worker.

## Critérios de aceite
1. Se `js/app.js` ou qualquer módulo importado falhar (rede, export ausente, SyntaxError), em até 10 s a abertura mostra mensagem em português simples e o botão "Atualizar arquivos". Teste: `tests/abertura.test.js` confere no `index.html` o botão e o script clássico que o liga (que não depende dos módulos), sem depender de navegador.
2. O botão "Atualizar arquivos" na abertura: cancela o registro do service worker, apaga todas as caches (`caches.delete`) e recarrega com `location.reload()`. Não chama `indexedDB.deleteDatabase`, `IDB.clear`, `IDB.del` nem mexe em `localStorage`. Teste: `tests/abertura.test.js` lê o código do botão e falha se aparecer qualquer um desses termos.
3. `js/app.js` marca no início da execução (`window.__cicloIniciou = true`, antes de qualquer `await`) para o script da abertura saber que o código carregou. Se carregou mas os dados não abriram em 10 s, a mensagem é a do banco (item 4), não a de arquivos. Teste: `tests/abertura.test.js`.
4. `IDB.open()` e `migrateOldDb()` tratam `onblocked` e têm limite de tempo (8 s). Ao estourar, rejeitam com erro claro; o `catch` de `js/app.js` mostra no `#view` o aviso "Não consegui abrir seus dados. Feche outras janelas do Ciclo e abra de novo. Seus dados não foram apagados." e chama `fecharAbertura()`. Teste: `tests/estado.test.js` (ou novo `tests/idb-travado.test.js`) com `indexedDB` simulado que nunca responde, conferindo que a promessa rejeita dentro do limite (usar tempo curto injetável).
5. Atualização sem mistura: depois de uma atualização, página, estilos e todos os `.js` vêm do mesmo conjunto de arquivos (mesma `VERSION`). Teste: `tests/modulos.test.js` confere que o `fetch` do `sw.js` usa só a cache `VERSION` (nunca `caches.match` sem nome de cache) e que `FILES` continua completo.
6. `sw.js`: quando o arquivo não está em lugar nenhum, a resposta é um erro explícito (`Response.error()`), não `undefined`. Teste: `tests/modulos.test.js` (texto do `sw.js`).
7. `applyUpdate()` espera `reg.update()` terminar e o service worker novo assumir antes de apagar caches antigas (apaga só as de nome diferente da `VERSION` atual), em vez de apagar todas. Teste: `tests/estado.test.js` ou novo teste com `caches` e `navigator.serviceWorker` simulados.
8. Nenhum teste ou texto novo traz dados reais; `node --test` passa e `node scripts/versao.mjs --check` continua batendo.

## Arquivos afetados
- `index.html`: o script de segurança da abertura (hoje só mostra o aviso após 10 s) passa a mostrar a mensagem e o botão "Atualizar arquivos"; troca de texto conforme `window.__cicloIniciou`. Continua inline e clássico (não pode depender dos módulos). Conferir 360 px, tema claro e escuro (a abertura é petróleo fixo; botão com contraste legível sobre `#0e4f5c`).
- `js/app.js`: `window.__cicloIniciou = true` no começo; mensagem do `catch` mais clara.
- `js/app/armazenamento.js`: `onblocked`, limite de tempo em `IDB.open()` e `migrateOldDb()`.
- `js/app/atualizacao.js`: `applyUpdate()` mais seguro (critério 7).
- `sw.js`: servir tudo da cache `VERSION`; `Response.error()` no vazio. Subir `VERSION` junto com a versão do app (feito pelo publicador com `node scripts/versao.mjs`).
- `tests/abertura.test.js`, `tests/modulos.test.js`, `tests/estado.test.js` (ou teste novo): critérios acima.
- `CHANGELOG.md`: entrada de correção (o publicador escreve a versão).

## Fora do escopo
- Qualquer mudança no formato ou local dos dados (IndexedDB, backup, Drive, sincronização).
- Voltar a ter `index.html` sem módulos, ou empacotar os módulos (é a decisão do #8 em `DECISOES.md`).
- Trocar a animação da abertura (#29).
- Modo offline completo de bibliotecas pesadas (Tesseract continua cache-first como hoje).

## Decisões em aberto
1. **Como evitar cache misto no service worker.** A: cache-first da cópia `VERSION` para todos os arquivos do app, que é pré-carregada de uma vez no `install` (`addAll` é tudo-ou-nada); a versão nova chega pelo `sw.js` novo (`skipWaiting` + `claim`, já existentes) e vale na abertura seguinte. B: manter rede-primeiro por arquivo e só acrescentar o botão de resgate. **Recomendada: A**, porque elimina a mistura na origem; B só trata o sintoma. *Com padrão* (segue a A). Atenção: com A, `version.json` e o aviso de versão nova continuam por rede (não entram na cópia).
2. **Limite de tempo do banco.** A: 8 s para abrir o IndexedDB. B: sem limite. **Recomendada: A**; é abaixo dos 10 s do aviso da abertura. *Com padrão*.
3. **Texto e lugar do botão.** "Atualizar arquivos" na abertura, igual ao nome que ela já conhece em Ajustes. *Com padrão*.
4. **Se a causa real for outra** (ex.: sintoma só com IndexedDB bloqueado, vindo dos comentários da issue): manter os critérios 3, 4 e 2 e tratar o 1/5 como proteção. *Com padrão*. Nenhum item cai em regra de bloqueio do `CLAUDE.md`: não apaga dados, não muda decisão registrada, não publica.

## Precisa de arquiteto?
Não. Muda só a estratégia de cache do service worker e o tratamento de erro na abertura; não altera armazenamento, formato de dados, estrutura de módulos nem contrato entre sistemas. (Se o desenvolvedor concluir que precisa mexer na lista `FILES` ou criar módulo novo, volta a avisar.)

## Teste no celular / no PC
Só a Jéssica confere no celular (etiqueta `teste-no-celular`):
- Com rede fraca (modo avião ligado e desligado durante a abertura), abrir o app depois de uma atualização: ele abre, ou aparece a mensagem com o botão em até 10 s.
- Tocar "Atualizar arquivos" na abertura: o app reinicia e **os cartões, extratos, fotos e senhas continuam lá**.
- Abrir o app em duas janelas ao mesmo tempo: a segunda abre ou mostra o aviso dos dados, sem ficar girando.
- Em Ajustes, "Atualizar arquivos" ainda funciona e o app abre offline depois.
No PC (verificador): simular offline/arquivo faltando no DevTools (bloquear `js/app/telas.js`) e ver a mensagem com o botão, em 360 px, tema claro e escuro.
