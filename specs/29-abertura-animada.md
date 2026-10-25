# Spec #29 · Abertura do app: sem borda e com animação

## Objetivo
Ao abrir o Ciclo instalado, a tela de abertura não deve mostrar a borda fina do quadrado do ícone, e logo depois deve aparecer o símbolo do Ciclo animado (o anel gira e a bolinha laranja chega ao seu ponto no anel) enquanto o app carrega, na mesma cor da tela do sistema, parecendo uma coisa só. Sem atrasar a abertura: a animação só dura o tempo que o app leva para ficar pronto.

## O que foi apurado no código (já existe)
- A tela de abertura do Android é montada pelo Chrome com `background_color` `#0e4f5c` do `manifest.webmanifest` e um ícone da lista `icons`. Ela é estática: não dá para animar. A cor é sempre a do manifest, **qualquer que seja o tema do aparelho** (o manifest não tem versão escura). Já o `theme-color` do `index.html` (`#f3f7f7` claro, `#081417` escuro, por `prefers-color-scheme`) vale só depois que a página carrega: pinta a barra de cima do Android. Ou seja: a abertura é petróleo nos dois temas; o tema só importa a partir do momento em que o app aparece.
- Causa da borda: `icons/icon-192.png` e `icon-512.png` (`purpose: any`) são um quadrado arredondado petróleo `#0e4f5c` com cantos transparentes (conferido no pixel). Sobre o fundo petróleo da abertura, a borda suavizada do quadrado deixa um contorno visível. `icons/maskable-512.png` é petróleo de ponta a ponta (sem cantos), então não teria borda.
- Não há fonte SVG dos ícones nem script que os gere (só os PNG, commit "v1.4.0: ícones do Ciclo"). O símbolo existe como SVG em `index.html` (`.brand-mark`, `viewBox 0 0 48 48`): anel `M35.3 15.5A14 14 0 1 0 38 24`, traço `#7fe0d0` largura 5,5, ponta redonda; bolinha `cx 35.6 cy 15.6 r 4.6` `#ffb547`.
- Hoje o `index.html` só tem `<div id="view"><div class="empty">Carregando…</div></div>`; os módulos (`<script type="module" src="js/app.js">`) só rodam depois do HTML. `js/app.js` (IIFE perto do fim) abre o banco, chama `render()` e, no `catch`, escreve o aviso de erro em `#view`. O `sw.js` serve `index.html` rede primeiro com cópia offline (chave `index.html`), então tudo que for inline no HTML aparece antes dos módulos e funciona offline sem mudar o `sw.js`.
- `styles.css` já tem bloco `@media (prefers-reduced-motion: reduce)` que encurta animações para 0,01 ms.

## Critérios de aceite
1. A tela de abertura do sistema deixa de ter contorno do quadrado: os ícones `any` (`icons/icon-192.png`, `icon-512.png`) passam a ser o símbolo sobre fundo petróleo `#0e4f5c` de ponta a ponta, sem cantos transparentes e sem quadrado arredondado. Teste: `tests/abertura.test.js` lê os PNG (cabeçalho + decodificação mínima com `zlib`, sem dependência nova) e confere que os 4 cantos e o meio das bordas têm o pixel `#0e4f5c` opaco. Conferência final no celular (abaixo).
2. `icons/maskable-512.png` continua com o símbolo dentro da zona segura (círculo central de 80%) e `manifest.webmanifest` mantém os três ícones com os mesmos `purpose` e `background_color`/`theme_color` `#0e4f5c`. Teste: "manifest mantém ícones e cor de abertura"; "símbolo do maskable dentro da zona segura" (nenhum pixel de menta ou âmbar fora do círculo de raio 40% da largura).
3. `index.html` ganha a tela de carregamento `#abertura`, **inline** (HTML e `<style>` no `<head>`; não depende de `styles.css` nem de módulo): fundo `#0e4f5c` fixo nos dois temas, tela cheia (`position: fixed; inset: 0`, acima de tudo, `100dvh`), símbolo SVG centralizado (anel menta `#7fe0d0`, bolinha âmbar `#ffb547`, mesmas formas do `.brand-mark`), `role="status"` e texto oculto para leitor de tela "Abrindo o Ciclo". Teste: "index.html tem #abertura inline antes de styles.css", "cor de #abertura é igual a background_color do manifest".
4. Animação (só `transform` e `opacity`, sem biblioteca): a bolinha entra girando em volta do anel e para no ponto dela (ponta aberta do anel, `35.6, 15.6`) em cerca de 0,8 s; depois o anel gira devagar (uma volta em cerca de 1,6 s) enquanto o app carrega. O quadro final (parado) é igual ao ícone. Conferência no PC (360 px) e no celular.
5. Nada de atraso artificial: a tela some assim que o app terminar o primeiro `render()` (e também no `catch` de erro, para o aviso de erro aparecer). Saída com esmaecer de 150 ms e `pointer-events: none` desde o início da saída; depois o elemento é removido do DOM. Teste: `tests/abertura.test.js` confere que `js/app.js` chama a função que remove `#abertura` depois do `render()` e dentro do `catch`; e que não existe `setTimeout` ligado à abertura com tempo mínimo.
6. Se por algum motivo o app não ficar pronto em 10 s (módulo que falhou, banco travado), o texto de `#abertura` passa a dizer "Está demorando mais que o normal. Feche e abra o app de novo." (script inline, sem módulo). Teste: "script inline de segurança existe" (confere o texto no HTML).
7. `prefers-reduced-motion: reduce`: o símbolo aparece parado (sem rotação e sem entrada da bolinha) e a saída é instantânea. Teste: "abertura tem regra de reduced-motion" no `index.html`.
8. Temas: a tela de carregamento é petróleo nos dois temas (igual à do sistema); ao sair, o app aparece no tema claro ou escuro como hoje, sem piscar. Enquanto `#abertura` existir, a barra de cima também fica petróleo: o script inline troca o conteúdo das duas metas `theme-color` para `#0e4f5c` e, ao remover a tela, devolve `#f3f7f7` e `#081417`. Teste: "metas theme-color voltam aos valores originais" (confere os valores no HTML e no código de remoção). Conferência visual no celular em claro e escuro.
9. O texto "Carregando…" sai de `#view` (fica vazio até o primeiro `render()`); nenhuma tela perde texto. Teste: `node --test` inteiro passa.
10. Funciona offline: nada novo é buscado da rede (tudo inline). Se for criado qualquer arquivo novo em `js/`, entra no `FILES` do `sw.js` (`tests/modulos.test.js` confere); a recomendação é não criar. Teste: `node scripts/versao.mjs --check` e `node --test` passam; conferência offline no celular.
11. Dados pessoais: nada de nome, saldo ou final de cartão na tela de abertura nem nos testes (os testes só leem cores e pixels). Revisão do diff.
12. Versão nova (patch) pelo publicador: `node scripts/versao.mjs X.Y.Z` e entrada no `CHANGELOG.md`. A versão nova do `sw.js` é o que faz o celular trocar os ícones guardados em cache (a pasta `icons/` é servida do cache primeiro).

## Arquivos afetados
- `index.html`: `<style>` inline da `#abertura` e suas animações no `<head>` (antes do `<link rel="stylesheet">`); `<div id="abertura">` com o SVG como primeiro filho de `<body>`; script inline que troca/restaura `theme-color` e o aviso dos 10 s; remove o "Carregando…" de `#view`.
- `js/app.js`: função pequena `fecharAbertura()` (restaura metas, esmaece, remove) chamada logo depois do primeiro `render()` e no `catch`. Pode ficar em `js/app.js` mesmo (lógica de 10 linhas, não justifica módulo novo).
- `icons/icon-192.png`, `icons/icon-512.png`: refeitos (símbolo sobre petróleo de ponta a ponta). `icons/maskable-512.png`: só se for preciso conferir tamanho; hoje já serve.
- `icons/icone.svg` (novo, fonte do ícone, opcional mas recomendado): quadrado `#0e4f5c` 512x512 com o símbolo. Não precisa estar no `FILES` (só serve para gerar os PNG).
- `tests/abertura.test.js` (novo): critérios 1, 2, 3, 5, 6, 7, 8.
- `CHANGELOG.md`, versão nova via script (pelo publicador).
- `manifest.webmanifest`: sem mudança prevista (se a decisão 1 for B, muda um `purpose`). `sw.js`: sem mudança além da versão.

## Como gerar os PNG sem dependência nova
Não há script nem fonte hoje. Usar o `icons/icone.svg` e desenhar nos tamanhos 192 e 512 no navegador do PC (página local com `<canvas>`, `drawImage` do SVG e `toBlob`, ou captura do Edge/Chrome em modo sem cabeça: `--headless --screenshot --window-size=512,512`). Não adicionar ferramenta ao projeto nem ao `package.json`. O desenvolvedor descreve o passo usado no commit. Na nuvem, se não houver navegador, o PNG também pode ser montado direto em Node com `zlib` (preenche o fundo e desenha anel e bolinha por distância), mantendo o resultado igual ao SVG.

## Fora do escopo
- Animar a tela de abertura do sistema (não é possível) ou mudar a cor de abertura por tema (o manifest só tem uma).
- Trocar a identidade (cores, símbolo, nome) ou o ícone da tela inicial além de remover a borda.
- Tela de abertura em outros momentos (trocar de aba, ler cupom); iOS.
- Mostrar versão, nome ou progresso na tela de carregamento.

## Decisões em aberto
1. **Como tirar a borda.** A: ícones `any` viram quadrado cheio de ponta a ponta (sem cantos transparentes). B: `maskable-512.png` também entra como `"purpose": "any maskable"` e o Chrome usa o ícone cheio na abertura. C: ícones `any` só com o símbolo, fundo transparente. Recomendada: A (a abertura fica sem borda em qualquer ícone que o Chrome escolher; B depende de como o Chrome escolhe; C some em fundo claro, p.ex. na tela de instalar). Efeito colateral de A: fora da abertura (convite de instalação, atalhos) o ícone aparece quadrado em vez de arredondado; o Android arredonda a tela inicial pelo maskable. *Com padrão.*
2. **Duração.** A: só enquanto carrega. B: tempo mínimo fixo (p.ex. 1 s). Recomendada: A (pedido de não atrasar; no uso normal a tela pode durar poucos décimos de segundo, e a animação da bolinha pode nem terminar, o que é aceitável). *Com padrão.*
3. **Cor durante o carregamento.** A: petróleo fixo nos dois temas (igual à tela do sistema, sem piscar). B: seguir o tema do aparelho. Recomendada: A, porque a tela do sistema é sempre petróleo e B faria um salto de cor. *Com padrão.*
4. **Barra de cima durante o carregamento.** A: trocar as metas `theme-color` para petróleo enquanto a tela existir e restaurar depois. B: não mexer (barra clara/escura sobre tela petróleo). Recomendada: A. Se no celular não funcionar (o Chrome pode ignorar a troca em app já aberto), manter B sem insistir. *Com padrão.*
5. **Onde fica o código de fechar.** A: função em `js/app.js`. B: módulo novo `js/app/abertura.js` (entra em `FILES`). Recomendada: A. *Com padrão.*
6. **Fonte do ícone.** A: criar `icons/icone.svg`. B: só regenerar os PNG. Recomendada: A (próximas mudanças não dependem de refazer o desenho à mão). *Com padrão.*

Nenhuma decisão cai em regra de bloqueio do `CLAUDE.md` (não mexe em decisão registrada no `DECISOES.md`, só ajusta a apresentação da identidade já escolhida: petróleo, menta, âmbar, anel aberto com ponto).

## Precisa de arquiteto?
Não. Não muda armazenamento, formato de dados, estrutura de módulos nem contrato entre sistemas: é HTML/CSS inline, uma função em `app.js` e três imagens.

## Teste no celular / no PC
No PC (verificador, 360 px, claro e escuro, com "Reduzir movimento" ligado e desligado): ver `#abertura` com a internet lenta (aba Rede do Chrome em "3G lenta") e conferir que some sozinha ao carregar; teste `node --test`.
Só a Jéssica, no celular (etiqueta `teste-no-celular`), depois de atualizar o app e **reinstalar o atalho** se o ícone da tela inicial não trocar:
1. Fechar o app por completo e abrir pelo ícone: a tela de abertura não mostra mais contorno em volta do ícone.
2. Logo depois, a bolinha chega ao anel e o anel gira, sem salto de cor nem de tamanho do símbolo em relação à tela do sistema (se o tamanho destoar, anotar para ajustar).
3. Repetir com o celular em tema claro e em tema escuro: a abertura é petróleo nos dois; o app aparece no tema certo.
4. Repetir em modo avião: abre igual.
5. Ícone na tela inicial continua bem recortado (círculo, quadrado arredondado, o que o aparelho usar).
