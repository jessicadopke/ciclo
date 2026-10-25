# Spec #9 · B-23 · Sincronizar com uma Planilha Google (dois celulares)

Nota: escrita sem acesso à issue; parte do resumo do gerente. Se o corpo da issue divergir, vale o da issue. Tamanho G: **entregar em 4 etapas (seção "Divisão em etapas")**, uma por execução. Cada etapa tem seus critérios; os "Pronto quando" da issue só fecham na etapa 3.

## Objetivo

Os dados do Ciclo passam a ficar também numa Planilha Google da Jéssica, e um segundo celular pode usar a mesma carteira. Lançar num celular faz aparecer no outro e na Planilha, mesmo se um deles estiver sem internet na hora. O celular continua sendo a cópia principal: grava primeiro nele, e a Planilha é só a "ponte" e a consulta.

## Situação atual (para o desenvolvedor)

- Dados em IndexedDB (`js/app/armazenamento.js`): lojas `cards`, `txs`, `receipts` (chave `id`) e `meta` (chave `"main"`). Gravação só via `Store.put/patch/remove/setMeta`. **`Store.remove` apaga de verdade, sem deixar rastro** (não há como saber que algo foi apagado em outro aparelho).
- `id` vem de `uid()`; registros têm `createdAt` mas **não** têm "última mudança" (`updatedAt`).
- Cartão tem `secret` (senhas já cifradas com a chave do cofre, `js/app/cripto.js`; cifrado no aparelho) e `balance`. `meta.vault = { salt, ...check }` guarda o sal e a verificação da senha mestra.
- Backup no Drive já existe (`js/drive.js`, `js/app/backup.js`, `apps-script/backup.gs`, spec #2): `S.meta.drive = { url, secret, ligado }` fora do backup. O Apps Script do backup **não muda**; a planilha usa um segundo script (ver abaixo) para não arriscar o backup que já funciona.

## Contrato app ↔ Apps Script da planilha (a fixar na etapa 2; esboço)

Mesmo estilo do #2: App da Web, "Qualquer pessoa", `fetch` POST com corpo JSON sem `Content-Type` customizado, código secreto no corpo, resposta `{ ok:true,... }` ou `{ ok:false, erro }`. Novo arquivo `apps-script/planilha.gs` (sem segredo nem URL reais). Ações previstas:

| `acao` | Corpo extra | Resposta |
|---|---|---|
| `enviar` | `aparelho`, `registros: [{ loja, id, mudou, apagado, dados }]` (lote até ~500) | `{ ok, aceitos, marca }` |
| `buscar` | `desde` (marca devolvida antes; 0 = tudo) | `{ ok, registros: [...], marca }` |
| `estado` | — | `{ ok, cartoes, lancamentos, marca }` (para "Testar conexão") |

`marca` é um contador crescente mantido pelo script (não relógio do celular), usado só para "me dê o que chegou depois". O script usa `LockService` para dois envios simultâneos não se atropelarem. Planilha: abas **Cartões** e **Lançamentos**, uma linha por registro, colunas legíveis (nome, titular, data, valor, loja, categoria, "última mudança", "apagado") mais uma coluna técnica `dados` (JSON do registro) que o app usa para sincronizar; abas só para consulta (editar à mão não é suportado; escrever isso na primeira linha/nota da aba). A planilha **nunca** recebe `secret` em claro nem a senha mestra; do cofre só vão `secret` (texto cifrado) e `meta.vault` (sal + verificação), numa aba técnica **Cofre**.

## Critérios de aceite

Etapa 1 (fundação, sem rede):
1. Todo registro de `cards` e `txs` ganha `updatedAt` (ms) a cada `Store.put/patch`; registros antigos sem `updatedAt` recebem `createdAt` na primeira abertura (migração sem perder nada). Prova: `tests/sync-base.test.js` (put/patch carimbam; migração idempotente; backup antigo restaurado continua válido).
2. Apagar vira **marca de apagado** (`apagado: true`, `updatedAt` novo, resto dos campos mínimo) em vez de sumir do banco; a interface e todos os cálculos (saldo, extrato, gráficos, avisos) ignoram registros apagados. Prova: teste de que `S.cards/S.txs` visíveis não incluem apagados e de que saldo/Gastos não mudam; teste de apagar cartão com lançamentos. Marcas com mais de 90 dias podem ser limpas (ver decisão 6).
3. Função pura `Sync.mesclar(local, remoto)` em `js/sync.js`: por `(loja, id)` vale o de maior `updatedAt`; empate decidido por `aparelho` (ordem alfabética) para ser igual nos dois lados; apagado mais novo vence edição mais velha e vice-versa; lançamentos com ids diferentes **sempre ficam os dois**. Prova: `tests/sync-mesclar.test.js` — lançamento A só no celular 1 e B só no celular 2 → resultado tem A e B nos dois sentidos; mesmo cartão editado nos dois → vale o mais recente; edição vs. apagado; mesclar duas vezes dá o mesmo resultado; ordem dos argumentos não muda o resultado.
4. `id` novo é gerado de forma que dois aparelhos nunca repitam (inclui identificador do aparelho ou aleatório longo). Prova: teste de `uid()` (10 000 ids sem repetir, nos dois formatos aceitos: ids antigos continuam válidos).
5. **Saldo** não pode divergir entre aparelhos: após mesclar, o saldo do cartão é recalculado a partir dos lançamentos (ou o campo `balance` é tratado como derivado; o arquiteto define na etapa 1, ver "Precisa de arquiteto"). Prova: teste mesclando lançamentos de dois aparelhos e conferindo o saldo igual ao de um único aparelho que tivesse todos.

Etapa 2 (enviar para a Planilha):
6. `apps-script/planilha.gs` existe, com passo a passo em português simples no topo, `configurar()` que grava o segredo nas Propriedades, ações `enviar`/`buscar`/`estado`, trava com `LockService`, cria abas e cabeçalhos se faltarem, e só mexe na planilha vinculada. Prova: `tests/planilha-script.test.js` com `vm` e `SpreadsheetApp`/`PropertiesService`/`LockService`/`ContentService` falsos: segredo errado → `erro:"segredo"`; `enviar` cria linha nova e atualiza a existente (não duplica); registro mais velho que o da planilha é ignorado; `buscar desde=N` devolve só o que chegou depois; apagado vira linha marcada, não some; JSON inválido → `formato`; lote grande → `tamanho`.
7. Novo `js/sync.js` (objeto `Sync` global, como `Drive`) com `enviar`, `buscar`, fila e `chamar` reaproveitando o jeito do `Drive.chamar`. Config em `S.meta.sync = { url, secret, ligado, aparelho, marca, fila }`, **fora do backup e fora do Drive**, como o `meta.drive`. Prova: `tests/sync.test.js` com `fetch` falso: monta corpo com segredo; rede fora e resposta não-JSON não derrubam nada.
8. **Fila offline**: toda gravação local (que muda `cards`/`txs`) coloca o id numa fila persistida em `meta.sync.fila`; a fila é enviada quando houver internet (ao abrir, ao voltar `online`, após cada gravação) e só sai da fila depois de a resposta `ok`. Falha mantém na fila, sem toast de erro. Prova: teste: 3 lançamentos offline → fila com 3; internet volta → um `enviar` com os 3 e fila vazia; falha no meio → fila intacta; enviar de novo não duplica.
9. Ajustes ganha **Sincronizar com a Planilha**: campo do link, código secreto gerado pelo app (copiar / gerar outro), **Testar conexão** ("Conectado: N cartões, M lançamentos" ou erro em português), liga/desliga, **Enviar tudo agora** (primeira carga) e linha "Última sincronização: …/ N a enviar". Desligar não apaga nada local nem da planilha. Prova: teste de renderização/estado básico quando possível + conferência manual.

Etapa 3 (dois celulares):
10. **Buscar mudanças** do outro aparelho ao abrir o app e a cada 5 minutos com o app aberto (e ao voltar para o primeiro plano), sem travar a tela; aplica com `Sync.mesclar`, grava local e atualiza a tela aberta. Prova: teste de integração com planilha falsa em memória: celular A lança → envia; celular B abre → busca → tem o lançamento; ida e volta estabiliza (nenhuma mudança nova na segunda rodada).
11. **Simultâneos nunca se perdem**: A e B lançam offline ao mesmo tempo, voltam à internet em qualquer ordem → os dois lançamentos existem nos dois aparelhos e na planilha, sem duplicar. Prova: teste de simulação com dois "aparelhos" falsos e a planilha falsa, nas duas ordens de chegada.
12. Mesmo cartão editado nos dois: vale o mais recente (`updatedAt`); campos não são misturados. Prova: teste (critério 3 na ponta a ponta).
13. Apagar em um aparelho some do outro (via marca de apagado); apagar não ressuscita se o outro aparelho tinha o registro antigo. Prova: teste.
14. Segundo celular entra pela tela "Usar a carteira que já existe": cola link e código, o app baixa tudo (`buscar desde=0`) para um banco vazio, sem sobrescrever dados locais existentes (se o banco local tem dados, mostra a escolha "juntar" ou "cancelar"; nunca apaga sozinho). Prova: teste de primeiro carregamento em banco vazio e em banco com dados.
15. Relógios desajustados: se o relógio do aparelho estiver mais de 5 minutos fora da hora que o script devolve (`hora` na resposta), o app avisa "A hora do celular está errada; ajuste para não perder mudanças." e mesmo assim não perde lançamentos. Prova: teste da função pura de diferença.

Etapa 4 (cofre e fotos):
16. **Cofre**: `secret` dos cartões viaja só como texto cifrado (já cifrado no aparelho antes de entrar na fila); `meta.vault` (sal + verificação) vai na aba Cofre; o segundo aparelho adota o `vault` do primeiro e abre com a **mesma senha mestra**. Trocar a senha mestra num aparelho recifra todos os `secret`, atualiza `vault` e `updatedAt` de todos, e o outro aparelho pede a senha nova na próxima abertura do cofre. Prova: teste: nenhuma carga enviada contém texto em claro das senhas de teste (procurar a senha fictícia no corpo do `fetch`); segundo aparelho abre cofre com a mesma senha; troca de senha propaga; conflito de dois `vault` diferentes mantém o mais recente e avisa.
17. **Fotos dos cupons**: conforme decisão 1 (recomendada A: só no aparelho). Prova (A): teste de que `receipts` nunca aparecem em `enviar`; no outro celular o lançamento aparece sem foto e a tela mostra "Foto só no outro celular." em vez de erro.

Gerais (todas as etapas):
18. `js/sync.js` e qualquer arquivo novo em `js/`/`js/app/` entram no `index.html` e em `FILES` do `sw.js`; `apps-script/` não entra. `node --test` e `node scripts/versao.mjs --check` passam; entrada MINOR no CHANGELOG (o publicador cuida da versão).
19. Dados de teste fictícios; nenhum link, segredo, finais, saldos ou nomes reais em arquivo versionado.
20. Textos em português simples; 360 px, tema claro e escuro sem quebra.
21. Texto de "Onde ficam seus dados" (`aboutSheet`) e README atualizados: "Se você ligar a Planilha, os lançamentos, cartões (sem número completo) e as senhas **cifradas** também ficam na sua Planilha Google."
22. Backup (arquivo e Drive) continua com o mesmo formato (`BACKUP_VERSION` não muda); `updatedAt` e marcas de apagado entram nos registros como campos extras, e restaurar backup antigo (sem esses campos) continua funcionando. Restaurar um backup com sincronização ligada pergunta antes e, ao confirmar, marca tudo como alterado agora para o backup valer nos dois aparelhos. Prova: testes existentes de backup continuam passando + teste novo de restaurar com sync ligado.

## Arquivos afetados

- `js/sync.js` (novo): `mesclar`, fila, `enviar`, `buscar`, `chamar`, `gerarSegredo` (pode reaproveitar `Drive.gerarSegredo`), diferença de relógio.
- `apps-script/planilha.gs` (novo): contrato acima.
- `js/app/armazenamento.js`: `Store` carimba `updatedAt`, apaga por marca, enfileira mudanças, gancho para disparar envio.
- `js/app/estado.js`: filtros que escondem apagados (`S.cards`/`S.txs` visíveis) e `uid()` (em `util.js`) com id seguro entre aparelhos.
- `js/app/cartoes.js`, `telas.js`, `pagamento.js`, `conferencia.js`, `inicio.js`, `cofre.js`: onde apagam/editam/consultam, ajustar para marcas de apagado e saldo derivado; cofre: propagar `secret`/`vault`.
- `js/app/backup.js`: restaurar com sync ligado; backup continua sem `meta.sync`.
- `js/app/telas.js` (Ajustes) e possivelmente novo `js/app/sincronizacao.js`: telas de Sincronizar, "Usar a carteira que já existe", status.
- `js/app.js`: iniciar busca ao abrir e temporizador de 5 min.
- `index.html`, `sw.js` (`FILES`), `styles.css` se preciso, `README.md`, `CHANGELOG.md`, `DECISOES.md`.
- `tests/sync-base.test.js`, `tests/sync-mesclar.test.js`, `tests/sync.test.js`, `tests/planilha-script.test.js` (novos); `tests/carregar.js` expõe `Sync`.

## Fora do escopo

- Editar na Planilha e refletir no app (a Planilha é só consulta; edição à mão pode ser sobrescrita).
- Mais de 2 a 3 aparelhos testados, ou pessoas com carteiras diferentes (é a mesma carteira da família).
- Tempo real/notificação push; vale abrir o app ou esperar os 5 min.
- Servidor próprio; login Google no app; OAuth.
- Fotos de cupom na Planilha (e no Drive, na opção A).
- Mudar o backup do Drive ou o `backup.gs`.
- Mesclar campo a campo dentro do mesmo registro.
- Chave do Gemini e `meta.drive` (continuam só no aparelho).

## Decisões em aberto

1. **Decisão:** fotos dos cupons nos dois celulares: Drive ou só no aparelho? (*bloqueio? não: com padrão; siga A.*)
   - **A (recomendada):** só no aparelho que tirou a foto — porque mantém a regra "dados só no aparelho", evita limite de 20 MB do Apps Script, custo e envio de foto de cupom (mostra compras) ao Google; o outro celular mostra o lançamento sem foto.
   - **B:** enviar fotos reduzidas para uma pasta do Drive dela e buscar sob demanda — dá a foto nos dois, mas aumenta trabalho (nova ação do script, fila de fotos grandes, limpeza) e expõe mais dados.
   Sigo com A. Se preferir outra, responda na issue até 48 h depois do comentário. *Com padrão.*
2. Acesso do App da Web "Qualquer pessoa" + código secreto longo no corpo, como no #2 (já decidido em `DECISOES.md`). Recomendada: igual. *Com padrão.*
3. Segundo script separado (`planilha.gs`) em vez de estender o `backup.gs`: protege o backup já publicado. Recomendada: separado. *Com padrão.* Alternativa: um só script (menos passos para ela, mais risco).
4. Frequência da busca: ao abrir + 5 min com o app aberto. Recomendada: essa. *Com padrão.*
5. Conflito no mesmo registro: "último que mudou vence" pelo `updatedAt` do aparelho, com empate por nome do aparelho. Recomendada: essa (pedido na issue). *Com padrão.*
6. Retenção das marcas de apagado: 90 dias (depois limpa). Recomendada: 90 dias; risco: aparelho parado mais de 90 dias poderia ressuscitar algo apagado, então busca com `desde=0` obrigatória nesse caso. *Com padrão.*
7. Nome do aparelho: gerado automático ("Celular 1/2" por sorteio curto) e editável. *Com padrão.*
8. Primeira ligação com dados em dois aparelhos já cheios: "juntar" (união, ids diferentes ficam todos). Recomendada: juntar com confirmação, nunca apagar. *Com padrão.*

Nenhuma cai em regra de bloqueio. Efeito em `DECISOES.md`: sincronização é nova exceção **opcional** a "Dados só no aparelho + backup" (como o Drive no #2); o desenvolvedor registra a decisão com data e #9 ao entregar a etapa 2. Não altera decisão existente.

## Precisa de arquiteto?

**Sim.** Muda formato de dados (campos `updatedAt`/`apagado` nos registros, `meta.sync`), semântica de apagar (tombstones em vez de remover), geração de ids, saldo derivado vs. gravado, e define o contrato app ↔ script e o relógio de mudanças (`marca` do servidor vs. `updatedAt` do aparelho). O arquiteto (Opus) deve fechar, antes da etapa 1: (a) saldo: derivar de lançamentos ou mesclar `balance`; (b) formato do id; (c) tombstones e limpeza; (d) contrato final `enviar/buscar`; (e) o que é `meta` sincronizado (só `vault`). Sem mudar o IndexedDB: se precisar de índice/versão nova do banco (`indexedDB.open(DB_NAME, 2)`), o arquiteto decide e escreve a migração.

## Divisão em etapas (cada uma = uma execução, uma versão MINOR/PATCH)

1. **Fundação** (arquiteto + critérios 1–5, 22): `updatedAt`, tombstones, `uid`, `mesclar`, saldo. Sem rede, sem tela nova; app igual para quem usa.
2. **Enviar para a Planilha** (6–9, 18–21): script, fila offline, tela de Ajustes, "Enviar tudo agora". Já entrega a Planilha de consulta e um celular.
3. **Dois celulares** (10–15): buscar/mesclar, simultâneos, tela do segundo celular. Fecha os três "Pronto quando" da issue (exceto cofre).
4. **Cofre e fotos** (16–17): senhas cifradas e mesma senha mestra; foto conforme decisão 1.

## Ação manual da Jéssica

Sim, da etapa 2 em diante: criar uma Planilha Google nova, abrir Extensões → Apps Script, colar `apps-script/planilha.gs`, rodar `configurar()` com o código copiado do app, Implantar como App da Web (executar como eu, acesso qualquer pessoa), autorizar e copiar o link. Em cada versão nova do script, **reimplantar** ("Gerenciar implantações → Editar → Nova versão"), senão o app fala com a versão velha. O `backup.gs` do Drive não precisa ser reimplantado.

## Teste no celular / no PC (só a Jéssica; etiqueta `teste-no-celular`)

Etapa 1: abrir o app com os dados atuais; conferir que cartões, saldos e extrato estão iguais; apagar um lançamento de teste e ver o saldo voltar certo; restaurar um backup antigo.
Etapa 2: no PC, criar a Planilha e o script (passos acima). No celular, Ajustes → Sincronizar → colar link → Testar conexão ("Conectado") → Enviar tudo agora; conferir as abas Cartões e Lançamentos. Modo avião: lançar 2 compras, abrir a Planilha (não aparecem), desligar o modo avião, esperar (ou reabrir o app) e conferir que as 2 apareceram, sem duplicar.
Etapa 3: no segundo celular (ou segundo navegador), "Usar a carteira que já existe" com o mesmo link e código. Lançar no 1 → aparece no 2 (até 5 min ou ao reabrir). Os dois em modo avião, um lançamento em cada, reconectar: os dois lançamentos nos dois celulares e na Planilha. Editar o mesmo cartão nos dois: fica o mais recente. Apagar num, some no outro. Ajustar o relógio de um celular para errado e ver o aviso.
Etapa 4: nos dois celulares, abrir o cofre com a mesma senha mestra; trocar a senha num e abrir no outro com a nova; olhar a aba Cofre da Planilha (só texto ilegível); conferir "Foto só no outro celular." (opção A).
Em todas: 360 px, tema claro e escuro.
