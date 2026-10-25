# Spec #26 · Cupom de cartão de vale impresso como CRÉDITO é lançado como crédito

## Objetivo
A maquininha imprime "COMPRA CRÉDITO" ou "DÉBITO" mesmo quando o cartão usado é um vale cadastrado. Hoje o app lê "crédito", deixa "Pago com vale" em 0,00 e joga o valor em "outras formas", sem descontar o saldo do vale. Depois desta mudança, se o final do cartão impresso é de um vale que a Jéssica cadastrou, o app trata o pagamento como vale, escolhe esse cartão e desconta o saldo, e avisa isso com clareza na conferência.

## Contexto do código (já existe)
- `js/gemini.js`: o esquema (`SCHEMA`) e `PROMPT` pedem `final_cartao`/`cartao_impresso` por pagamento, mas `toParsed` só aproveita o final (`last4`, `vales[]`, `last4s`) de pagamentos com `forma: "vale"`. `payments` sai só com `{kind, amount}`.
- `js/match.js` `matchReceipt(d, cards, txs, presetCardId, fallbackCardId)`: `valeAmts` vem só de `payments` com `kind === "vale"` (ou de `d.paid`); `others` é o resto; `perVale` (`d.vales`) alinha as pistas de cada vale por posição.
- `js/receipt.js` (Tesseract): `PAY_RULES` marca a linha "CREDITO"/"DEBITO" como `credito`/`debito`; `payments` não tem final por pagamento; há só `last4` e `last4s` do cupom inteiro. Se a mesma linha tem palavra de benefício (VR, ALELO, VOUCHER...) já vira `vale`.
- `js/app/conferencia.js` `reviewForm` usa `matchReceipt` para preencher "Pago com vale" (`parts`) e "outras formas" (`others`); `js/app/pagamento.js` `savePurchase` grava as partes e o desconto do saldo.
- Decisões relevantes do `DECISOES.md`: guarda-se só o final de 4 dígitos; repositório público (dados de teste fictícios); Tesseract é o padrão e o Gemini é opcional. Nenhuma decisão registrada é alterada por esta spec.

## Regra de negócio
A conversão acontece **na hora de casar o cupom com a carteira** (`matchReceipt`), porque só ali se sabe quais finais estão cadastrados. A leitura (`toParsed`, `receipt.js`) só passa a **entregar** o final de cada pagamento; ela não decide nada.

Um pagamento `credito` ou `debito` vira vale quando **todas** valem:
1. o pagamento tem final de 4 dígitos lido;
2. esse final é igual ao `last4` de pelo menos um cartão cadastrado e visível na carteira (não apagado);
3. o valor do pagamento é maior que zero.

Caso contrário nada muda (final desconhecido, final não lido, `pix`, `dinheiro`, `outro`).

## Critérios de aceite
1. `toParsed` (Gemini) mantém o final em cada item de `payments` (`last4`, e demais pistas do pagamento: emissor, titular, tipo, saldo) também para `credito`/`debito`, sem mudar o que já sai hoje para `vale` (`vales`, `last4`, `last4s`, `paid`, `balances`). `last4s`/`last4`/`paid` continuam contando só vales reais (a conversão é feita depois, no match). Teste: `tests/gemini.test.js`, "crédito com final: final fica no pagamento, paid continua só dos vales", com resposta salva nova em `tests/gemini/` (ex.: `credito-final-de-vale.json`, final `0000`, valores redondos, loja fictícia).
2. Crédito/débito com final de um vale cadastrado vira vale: `matchReceipt` devolve esse valor em `parts` (com `cardId` do cartão de final igual e `pick.reasons` contendo "final 0000"), fora de `others`, e `convertidos` lista `{amount, last4, kind original}`. Teste: `tests/cartao.test.js`, "crédito com final de vale cadastrado conta como vale".
3. Crédito com final que nenhum cartão cadastrado tem continua em `others` como crédito, sem `parts` novo. Teste: "crédito com final desconhecido continua crédito". Isto vale também para débito.
4. Final não lido no pagamento de crédito: continua crédito (não chuta cartão por emissor, saldo ou loja). Teste: "crédito sem final continua crédito".
5. Cupom misto: vale real + crédito de banco (final desconhecido) dividem como hoje; vale real + crédito com final de outro vale cadastrado dão duas partes de vale com cartões diferentes; vale + pix intacto. A soma `parts + others` continua igual ao total. Testes: "misto: vale e crédito comum", "misto: vale e crédito de outro vale", "vale e pix não muda".
6. Final igual em dois cartões cadastrados: converte mesmo assim (o final bate) e escolhe o cartão pelas outras pistas já existentes de `rankCards` (emissor, titular, saldo, loja). Se não houver desempate claro, `confident` fica falso e a conferência mostra o aviso "provável"/"fraco" já existente, para ela escolher. Os dois cartões não podem ser escolhidos para a mesma parte (regra `taken` existente). Teste: "final igual em dois cartões: converte e pede confirmação" e "dois pagamentos com o mesmo final em dois cartões iguais pegam um cartão cada".
7. Tesseract (`js/receipt.js`): cada item de `payments` ganha `last4` quando o final aparece na mesma linha do pagamento ou no comprovante TEF logo ao lado; se não der para ligar o final ao pagamento, `last4` fica ausente. Como o cupom do Tesseract costuma ter um só comprovante, vale a regra segura: se o cupom tem **exatamente um** pagamento `credito`/`debito`, nenhum `vale` e exatamente **um** final distinto em `last4s`, esse final é atribuído ao pagamento. Com mais de um pagamento de cartão ou mais de um final, não atribui (continua crédito). Testes: `tests/leitura.test.js`, "Tesseract: crédito com final único recebe o final" e "Tesseract: dois cartões sem ligação clara não atribui final", usando cupom fictício novo em `tests/cupons/` (ex.: `credito-final-de-vale.txt`, final 0000).
8. Os cupons de teste e respostas salvas atuais continuam dando o mesmo resultado (nenhum teste existente muda de expectativa). `node --test` passa inteiro.
9. Prompt do Gemini: reforçar a regra sem quebrar as respostas salvas. Em `PROMPT`, incluir: o comprovante da maquininha pode imprimir "CRÉDITO" ou "DÉBITO" mesmo para cartão de benefício; para **todo** pagamento com cartão (inclusive `credito`/`debito`) preencher `cartao_impresso` e `final_cartao` se estiverem impressos, nunca inventar; a classificação da forma continua como está (benefício só quando o emissor ou o texto indicar). Não mudar `SCHEMA` (os campos já existem), nem modelo, nem `generationConfig` (skill `leitura-gemini`). Teste: `tests/gemini.test.js`, "o prompt pede o final de todo pagamento com cartão" (confere que o texto de `PROMPT` exposto contém a instrução; se `PROMPT` não é exposto em `GeminiReader`, expor só para teste).
10. Tela de conferência (`js/app/conferencia.js`): quando houver `convertidos`, aparece um aviso informativo (classe `notice info`, no mesmo lugar dos avisos de cartão) e a linha "Pagamento:" mostra "vale" para a parte convertida. Textos exatos:
    - um pagamento: `O cupom diz "crédito", mas o final 0000 é do seu cartão Nome do cartão. Contei R$ 50,00 como vale. Se não for isso, mude o valor em "Pago com vale".`
    - vários: `O cupom diz "crédito" em N pagamentos, mas os finais são de cartões seus. Contei como vale: …` (lista valor + nome do cartão)
    - com cartão incerto (critério 6): `O cupom diz "crédito" e o final 0000 aparece em mais de um cartão seu. Escolha qual foi usado.`
    "Crédito" e "débito" aparecem como o cupom escreveu; nunca "kind", "converter" ou termos técnicos. O valor sai de "outras formas" e entra em "Pago com vale" já preenchido e editável; ela pode devolver para "outras formas" mudando os valores, como hoje. Conferência manual (ver abaixo) e teste de que `convertidos` traz o necessário para o texto.
11. Salvar a compra convertida desconta o saldo do cartão escolhido e grava como compra de vale (mesmo caminho de `savePurchase` das partes de vale); nenhuma forma nova em `otherPay`. Teste: `tests/cartao.test.js` confere que `parts` somado ao `others` bate com o total; o desconto em si é o fluxo existente (conferência manual).
12. Dados fictícios: finais `0000`/`1111`, nomes "Cartão A"/"Cartão B", valores redondos, loja inventada. Nada de dado real em testes, specs, mensagens de commit ou CHANGELOG. Revisão do diff.
13. Sem arquivo novo em `js/`: se o desenvolvedor criar um, entra no `FILES` do `sw.js` (`tests/modulos.test.js` confere). `node scripts/versao.mjs --check` continua passando (a mudança de versão fica para o publicador).

## Arquivos afetados
- `js/gemini.js`: `toParsed` guarda `last4` e pistas em cada item de `payments`; `PROMPT` ganha a regra do critério 9.
- `js/receipt.js`: `payments[].last4` conforme critério 7.
- `js/match.js`: início de `matchReceipt` aplica a regra de negócio e monta `valeAmts`, `others`, `perVale` e `convertidos` a partir dos pagamentos efetivos, mantendo a ordem; devolve também `payments` efetivos (com `kind: "vale"` nos convertidos) e `convertidos`. `rankCards` não muda.
- `js/app/conferencia.js`: aviso do critério 10 e `payLine` com os pagamentos efetivos.
- `tests/gemini.test.js`, `tests/gemini/credito-final-de-vale.json` (novo), `tests/leitura.test.js`, `tests/cupons/credito-final-de-vale.txt` (novo), `tests/cartao.test.js`.
- `CHANGELOG.md`: entrada fica a cargo do publicador, na versão.

## Fora do escopo
- Aprender sozinho que um final "é vale" a partir de lançamentos antigos ou por emissor/saldo sem final.
- Converter crédito/débito pelo emissor ou saldo quando o final não foi lido.
- Reclassificar lançamentos já salvos (compras antigas lançadas como crédito).
- Mudar `SCHEMA`, modelos ou limites do Gemini; mudar o formato dos dados salvos, o backup ou a sincronização.
- Tela de ajuste para "sempre tratar este final como vale" (hoje o cadastro do cartão já guarda o final).

## Decisões em aberto
1. **Onde converter: no match (recomendada) ou na leitura.** Na leitura não se sabe quais finais estão cadastrados; no match cobre Gemini e Tesseract com uma só regra. Classificação: *com padrão* (match).
2. **Final igual em dois cartões.** Opções: (A, recomendada) converter e escolher pelas outras pistas, pedindo confirmação se empatar; (B) não converter. A mantém o valor no campo certo e evita lançar sem desconto; o aviso do critério 10 deixa claro. *Com padrão* (A).
3. **Tesseract sem ligação clara entre final e pagamento.** Opções: (A, recomendada) só atribuir com um único pagamento de cartão e um único final; (B) tentar ligar por proximidade de linhas. B arrisca converter pagamento errado em cupom com dois cartões e não há amostras reais para provar; A é seguro e cobre o caso mais comum. *Com padrão* (A).
4. **Débito também converte?** Opções: (A, recomendada) sim, igual ao crédito; (B) só crédito. A maquininha imprime os dois para vale e a regra do final é a mesma. *Com padrão* (A).
5. **Aviso na tela: informativo (recomendada) ou pergunta antes de converter.** Informativo mantém a conferência de um toque e ela já edita os valores. *Com padrão* (informativo).
Nenhuma cai numa regra de bloqueio do `CLAUDE.md`.

## Precisa de arquiteto?
Não. Não muda armazenamento, formato dos dados salvos, estrutura de módulos nem contrato entre sistemas: o campo `last4` em `payments` é interno ao resultado da leitura (não é salvo) e o esquema do Gemini não muda.

## Teste no celular / no PC
Só a Jéssica consegue conferir (etiqueta `teste-no-celular`, checklist para o verificador colocar na issue):
- Foto de um cupom real de vale que a maquininha imprimiu como crédito, com o cartão cadastrado: "Pago com vale" vem preenchido, o cartão certo vem escolhido, o aviso aparece em português claro, e depois de salvar o saldo do cartão baixou.
- Cupom de crédito de banco comum: continua em "outras formas", sem aviso.
- Cupom misto (vale + cartão de banco): divisão correta.
- Leitura com Gemini e com o leitor do celular (Tesseract): os dois dão o mesmo resultado.
- Aviso legível em 360 px, tema claro e escuro.
