# Spec #7 · B-22 · Recorte automático da foto do cupom

## Objetivo
Quando a foto do cupom sai torta, de lado ou com mesa, mão e fundo atrapalhando, o app acha o papel, endireita e recorta antes de ler, tudo no celular. Ela vê o recorte, pode arrastar os cantos se errou e confirma; depois o leitor do celular (Tesseract) lê só o papel. Tem de ler melhor e sem passar de ~2 s a mais por foto.

## Contexto do código (já existe)
- `js/receipt.js`: `readText(blob, onProgress)` chama `prepare(blob)` (redimensiona para no máx. ~3,5 MP, cinza, contraste, binarização de Otsu, devolve `canvas`) e depois `worker.recognize(canvas)`. Modo de página do Tesseract: 4. `parse(texto)` interpreta o texto.
- `js/app.js`: `scanOne(file, cardId)` abre a folha "Ler cupom" com a foto e o andamento. Ordem: Gemini (se ligado) com `shrink(file, 1600, 0.8, false)`, senão `ReceiptReader.readText(file, ...)`. `shrink(file)` gera a foto que fica guardada (cinza, 1280 px). `startScan`/`scanQueue` tratam várias fotos em fila.
- `tests/cupons/*.txt` são **textos** de OCR anonimizados (não imagens); `tests/leitura.test.js` prova `ReceiptReader.parse`. Não há imagem de cupom no repositório e **não pode haver** (público; ver CLAUDE.md).
- `tests/carregar.js` carrega os scripts no Node via `vm` (sem DOM). Código de recorte precisa ser puro (arrays, sem canvas) para ser testável assim.

## Abordagem
Dividir em duas partes:
1. **Lógica pura** em `js/recorte.js` (novo, sem DOM, carregável no Node), trabalhando sobre um vetor de cinza `Uint8Array` com largura e altura.
2. **Cola com a tela** em `receipt.js` e `app.js` (canvas, `createImageBitmap`, folha de ajuste dos cantos).

Algoritmo sugerido (o desenvolvedor pode trocar por outro equivalente, desde que cumpra os critérios):
- Reduzir a foto a ~320 px no lado maior (cinza), suavizar levemente.
- Limiar de Otsu (já existe no `prepare`; extrair a função para reaproveitar) para separar papel claro de fundo.
- Maior região clara conectada (preenchimento por varredura, sem recursão) que não seja só a borda da imagem.
- Cantos: os 4 pontos extremos da região (menor/maior `x+y` e `x−y`), ordenados como topo-esq, topo-dir, base-dir, base-esq. Validar: área da região ≥ 15% da foto, quadrilátero convexo, lados com proporção plausível de cupom (alto/largo entre ~0,5 e ~12). Se não passar, devolver `null`.
- Endireitar: homografia dos 4 cantos para um retângulo (sistema 8×8 resolvido na mão), amostragem bilinear no cinza em resolução cheia. Saída com largura ~1100–1400 px e altura pela proporção, respeitando o teto de ~3,5 MP de hoje.
- Cupom térmico é longo e estreito, às vezes fotografado em duas partes ou só um trecho: se o papel sai do enquadramento, os cantos podem cair na borda da foto; isso é aceito (o canto vale a borda).

## Critérios de aceite
1. `Recorte.acharCantos(cinza, larg, alt)` (puro) devolve 4 cantos `{x,y}` ordenados (topo-esq, topo-dir, base-dir, base-esq) em coordenadas da imagem recebida, ou `null`. Teste em `tests/recorte.test.js`, com imagens sintéticas montadas no teste (fundo escuro, retângulo claro): "retângulo reto acha os 4 cantos (±2 px)".
2. Papel girado (ex.: 10° e 25°) e em perspectiva leve (trapézio) ainda acha os cantos com erro ≤ 3% do lado maior. Testes: "papel girado 10° e 25°", "papel em trapézio".
3. Sem papel reconhecível devolve `null`, sem lançar erro: imagem toda uniforme, só ruído, papel ocupando < 15% da foto, formato impossível. Testes: "foto lisa", "ruído", "papel pequeno demais", "formato absurdo".
4. Fundo claro (mesa branca) ou papel quase da cor do fundo não pode produzir recorte errado com confiança: ou acha o papel ou devolve `null` (o app então lê a foto inteira, como hoje). Teste: "fundo claro: acha ou devolve null, nunca um recorte pequeno dentro do papel" (cupom sintético com faixa de texto escuro dentro do retângulo claro não pode virar o retângulo menor).
5. `Recorte.endireitar(cinza, larg, alt, cantos, largSaida)` (puro) devolve `{dados, larg, alt}` com o papel como retângulo. Teste: imagem sintética com um padrão conhecido (faixas) girada; depois de endireitar, a faixa fica horizontal (comparar linhas/colunas com tolerância). Teste: cantos = imagem inteira devolve praticamente a mesma imagem.
6. `Recorte.homografia` (ou equivalente) é testada à parte: pontos dos 4 cantos mapeiam para os cantos do retângulo (±0,5 px); cantos degenerados (3 colineares) devolvem `null`. Teste: "homografia: cantos e caso degenerado".
7. `Recorte.validar(cantos, larg, alt)` (usada também quando ela arrasta os cantos na tela) recusa cruzados, não convexos, área < 15%, pontos fora da imagem (ou os trava dentro). Teste: "ajuste manual: cantos cruzados são recusados e pontos são limitados à foto".
8. Integração em `receipt.js`: `readText(blob, onProgress, opts)` aceita `opts.cantos` (já ajustados, em coordenadas da foto original) e `opts.recortar`. Sem `cantos` e com `recortar` ligado, detecta sozinho; com `null` ou erro, cai na leitura da foto inteira (comportamento atual) e registra "sem recorte" em "Como foi lido". Nunca deixa de ler por causa do recorte. Conferência manual + `readText` não é testável em Node (usa canvas): a parte pura fica em `recorte.js`.
9. Passo de confirmação na tela, antes de ler com o leitor do celular: a foto aparece com o contorno do recorte e 4 pontos que ela arrasta com o dedo (alvo de toque ≥ 44 px, `touch-action: none`), com os botões "Usar recorte" (principal), "Ler a foto inteira" e "Refazer sozinho". Textos em português simples. Dá para usar sem arrastar: "Usar recorte" já vale. Conferência manual (360 px, claro e escuro).
10. Fila de várias fotos: o recorte vale por foto; há opção "Recortar automaticamente sem perguntar" em Ajustes (padrão **desligada** na primeira versão, ver decisão 2), para quem manda muitas. Com ela ligada, não abre o passo 9, mas o resultado mostra o recorte usado (miniatura) e um botão "Ler de novo sem recorte". Conferência manual; a leitura da preferência (`S.meta.recorteAuto`) é testada se virar função pura.
11. Gemini não muda: continua recebendo a foto inteira (`shrink(file, 1600, 0.8, false)`), sem recorte (a imagem do Gemini ler bem sem ele; fica fora do escopo). A foto **guardada** com o lançamento continua sendo a original reduzida (`shrink`), não o recorte (ver decisão 4). Conferência manual.
12. Tempo: detectar + endireitar leva no máximo ~2 s extras num celular comum; o desenvolvedor mede e anota no pedido: tempo por etapa (reduzir, achar cantos, endireitar) em `performance.now()` e mostra a soma em "Como foi lido" ("Recorte: 0,6 s"). O recorte reduz o nº de pixels que vão para o Tesseract, então o tempo total costuma cair ou ficar igual; se passar de 2 s de custo líquido (recorte + leitura − leitura sem recorte), o recorte automático fica desligado por padrão e o passo 9 vira opcional ("Recortar a foto" como botão). Teste automático de proporção: `acharCantos` numa imagem sintética de 320×430 roda abaixo de 50 ms no Node (limite folgado, só para pegar regressão grosseira). Conferência manual de tempo no celular.
13. Medição de ganho: ver seção "Como medir". O pedido deve registrar na issue a tabela (nº de campos certos sem recorte / com recorte, por cupom de teste, sem dados reais, só contagens). Meta: com recorte lê **mais ou o mesmo** de campos em todas as fotos tortas e **não pior** nas retas; se piorar nas retas, o recorte só é oferecido quando os cantos fogem da moldura (ver decisão 1).
14. `js/recorte.js` entra no `index.html` (antes de `receipt.js`), em `FILES` do `sw.js` e em `tests/carregar.js` (exportar `Recorte`); `README.md` (Estrutura do projeto) ganha uma linha. `node scripts/versao.mjs --check` e `node --test` passam; o app abre offline.
15. Nenhuma imagem de cupom real, nem ainda "anonimizada", entra no repositório. Os testes usam imagens geradas no próprio teste. Revisão do diff.

## Como medir (campos certos com e sem recorte)
O repositório só tem texto de cupom, então a comparação com o Tesseract acontece no navegador do PC, fora do `node --test`:
- Página local `tests/medir-recorte.html` (não entra em `FILES` do `sw.js`, não é carregada pelo app): escolhe várias fotos do disco, roda `ReceiptReader.readText` sem e com recorte, passa pelo `parse` e mostra, por foto, quais campos saíram (valor pago, data, saldo, emissor, final do cartão, formas de pagamento) e o tempo de cada leitura. As fotos ficam só no computador dela; o gabarito é digitado na hora ou um arquivo `.json` **fora do repositório** (`.gitignore` dessa pasta local, p. ex. `tests/local/`).
- O verificador (ou a Jéssica) roda com ~10 fotos dela, inclusive retas, tortas e com mesa ao fundo, e posta na issue só a tabela de contagens.
- Se a Jéssica não puder fornecer fotos, o desenvolvedor fotografa um papel qualquer com texto fictício impresso (ex.: cupom simulado com valores redondos), nunca um cupom real. Esse resultado é só indicativo; o aceite real fica na conferência dela no celular.
- Limite conhecido: o Node não roda o Tesseract do app (WASM de navegador), então este ganho **não** tem teste automático; o que é automático é a geometria (critérios 1–7).

## Arquivos afetados
- `js/recorte.js` (novo): `acharCantos`, `validar`, `homografia`, `endireitar`, `otsu` (extraída do `prepare` e reaproveitada em `receipt.js`); sem DOM, usa `window` como os outros módulos.
- `js/receipt.js`: `prepare(blob, opts)` usa `Recorte` para reduzir/detectar/endireitar antes do contraste e da binarização; `readText` aceita `opts` e devolve (ou reporta) cantos usados e tempo do recorte. Sem mudar `parse`/`parseCard`.
- `js/app.js`: passo de confirmação dos cantos em `scanOne` (só no caminho do leitor do celular, antes de `readText`), tratamento da fila, item em Ajustes (decisão 2), linha "Recorte: …" em "Como foi lido".
- `index.html`: `<script src="js/recorte.js" defer>` antes de `receipt.js`.
- `styles.css`: contorno e alças do recorte (use `--accent`/âmbar do tema; 360 px, claro e escuro).
- `sw.js`: `js/recorte.js` em `FILES`; nova `VERSION` pelo script de versão.
- `tests/carregar.js` (exportar `Recorte`), `tests/recorte.test.js` (novo), `tests/medir-recorte.html` (novo, uso local), `.gitignore` (`tests/local/`).
- `README.md` (estrutura), `CHANGELOG.md`, versão nova (minor) via `node scripts/versao.mjs X.Y.Z`.

## Fora do escopo
- Recorte para o Gemini e para o cadastro de cartão por foto (`parseCard`); aqui é só o cupom no leitor do celular.
- Biblioteca externa (OpenCV.js e semelhantes): pesada demais, sem build, e quebra o offline leve do app.
- Guardar a foto recortada no lugar da original; remover sombra, dobras ou reflexo; juntar duas fotos de um cupom longo.
- Mudar o Tesseract, o idioma, o modo de página ou o `parse`.
- iOS e outros navegadores.

## Decisões em aberto
1. **Quando mostrar o passo de ajustar os cantos.** Opções: sempre; só quando o recorte achou algo diferente da foto inteira (cantos fora de ~3% da moldura); nunca (só botão). Recomendada: sempre que `acharCantos` devolver cantos que diferem da foto inteira; foto já reta e cheia pula direto para a leitura. Motivo: não adiciona toque em foto boa e protege a leitura quando o recorte erra. *Com padrão.*
2. **Recorte automático sem perguntar em Ajustes.** Opções: não oferecer; oferecer desligado; oferecer ligado. Recomendada: oferecer, desligado na primeira versão; ligar por padrão só depois que a Jéssica confirmar no celular. Motivo: erro de recorte esconde parte do cupom e a pessoa nem vê. *Com padrão.*
3. **Algoritmo.** Opções: limiar de Otsu + maior região clara + cantos extremos (simples, ~200 linhas); detecção de bordas/Hough (mais robusta, mais código e mais lenta). Recomendada: a primeira; só partir para a segunda se a medição mostrar falhas em fotos com fundo claro. *Com padrão.*
4. **Que foto fica guardada com o lançamento.** Opções: original reduzida (como hoje); recortada. Recomendada: original reduzida. Motivo: se o recorte errou, a imagem de conferência não pode ter perdido o cupom; não muda o formato guardado nem o peso do backup. *Com padrão.*
5. **Tamanho de saída.** Opções: ~1100 px de largura (como o piso de hoje); maior. Recomendada: manter o teto atual de ~3,5 MP e piso de 1100 px de largura. Motivo: mais pixels deixam o Tesseract mais lento sem ler melhor. *Com padrão.*
6. **Versão.** Recomendada: minor (função nova). O publicador decide o número. *Com padrão.*

Nenhuma decisão cai em regra de bloqueio do `CLAUDE.md`: não muda decisão registrada no `DECISOES.md` (Tesseract continua o padrão, tudo no aparelho, sem custo, sem conta, nada novo sai do celular). Registrar no `DECISOES.md`, depois da aprovação: "o recorte do cupom acontece só no aparelho, a foto guardada continua sendo a original reduzida".

## Precisa de arquiteto?
Não. Não muda armazenamento nem formato dos dados (a foto guardada é a mesma de hoje; a preferência nova é um campo em `meta`, fora do backup se for sensível ao aparelho, como a chave do Gemini, ou dentro, a critério do desenvolvedor, sem impacto de formato) nem contrato entre sistemas. É um módulo novo puro (`recorte.js`) mais uma etapa antes do OCR. Se o desenvolvedor concluir que precisa de biblioteca externa ou Web Worker próprio para cumprir os ~2 s, parar e pedir arquiteto.

## Teste no celular / no PC
No PC (verificador, 360 px, claro e escuro): `node --test` verde; abrir o app com o servidor local, escolher fotos fictícias (papel impresso com valores redondos) retas, tortas e sobre mesa; conferir contorno, alças, os três botões, fila de várias fotos, e a linha "Recorte: … s" em "Como foi lido". Rodar `tests/medir-recorte.html` e postar a tabela.
Só a Jéssica, no celular (etiqueta `teste-no-celular`):
- Fotografar 5 cupons dela de propósito tortos, de lado e sobre mesa/mão; ver se o contorno acerta o papel e se os 4 pontos arrastam bem com o dedo.
- Comparar, no mesmo cupom, "Usar recorte" e "Ler a foto inteira": anotar quantos campos (valor, data, saldo, final do cartão) vieram certos em cada.
- Anotar o tempo de "Recorte: … s" e o "Total" em "Como foi lido" num celular comum: o custo do recorte deve ser de até ~2 s.
- Dizer se o passo de ajustar atrapalha em fotos boas (decide se liga o automático por padrão).
