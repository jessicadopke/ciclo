# Ciclo — instruções para o Claude

PWA pessoal da Jéssica para o saldo dos cartões de vale (VR/VA/multibenefício) da família. HTML/CSS/JS puros, sem build; publicado pelo GitHub Pages a partir de `main` (https://jessicadopke.github.io/ciclo/). Estrutura dos arquivos: seção "Estrutura do projeto" do `README.md`. Decisões já tomadas: `DECISOES.md` (leia antes de propor algo que mude uma delas).

## Comandos

| Para | Comando |
|---|---|
| Testes (obrigatório antes de qualquer merge) | `node --test` |
| Versão nova (atualiza `js/app.js`, `sw.js`, `version.json` e confere o CHANGELOG) | `node scripts/versao.mjs X.Y.Z` |
| Conferir se os 4 lugares da versão batem | `node scripts/versao.mjs --check` |
| Ver no navegador (só no PC) | `python -m http.server 8765` nesta pasta, ou o preview "ciclo" |

Arquivo novo em `js/` ou em `js/app/` também entra na lista `FILES` do `sw.js`, senão o app quebra offline (`tests/modulos.test.js` confere).

## Regras do Ciclo

- **O repositório é público.** Nunca grave em arquivo versionado finais de cartão, saldos, nomes, CPFs ou cupons reais. Testes usam dados fictícios ou anonimizados.
- Só Android/Chrome. Dados só no aparelho (IndexedDB) + backup; nada de servidor próprio.
- Leitura de cupom: Tesseract no aparelho é o padrão; Gemini é opcional e a chave nunca sai do celular.
- Textos do app em português simples, para quem usa, não para programador.
- Mudança visual: conferir em 360 px, tema claro e escuro.
- Muitas funções só a Jéssica testa no celular: o verificador escreve esse checklist na issue com a etiqueta `teste-no-celular`.

## Publicação

1. O publicador escolhe a versão, escreve a entrada `## X.Y.Z — DD/MM/AAAA` no `CHANGELOG.md` e roda `node scripts/versao.mjs X.Y.Z` e `node --test` **no ramo `dev`**.
2. Abre o pedido `dev → main` "Publicar X.Y.Z" com `Closes #n` de cada issue e pede revisão a `jessicadopke`.
3. **A Jéssica aprova e faz o merge** (é a única porta para `main`; o que entra em `main` chega ao celular de quem usa o app).
4. O workflow `.github/workflows/release.yml` cria a tag `vX.Y.Z` e a release com as notas do CHANGELOG. O publicador confere e move os cartões para **Publicado**.

---

## Como o trabalho anda (igual nos dois projetos)

**Fonte da verdade:** as issues deste repositório e o quadro **Meus Apps** (https://github.com/users/jessicadopke/projects/1). O `BACKLOG.md` é o registro histórico até 22/10/2026; não acrescente itens nele.

**Papéis:** a sessão principal é o *gerente de produto* deste repositório. Ela não programa itens M/G: delega aos agentes em `.claude/agents/` (especificador, arquiteto, designer, desenvolvedor, verificador, publicador) e só lê os relatórios curtos deles.

| Tamanho | Caminho |
|---|---|
| P | desenvolvedor (direto da issue) → verificador |
| M / G | especificador → arquiteto (só se a spec pedir) → desenvolvedor → verificador |
| Com tela nova ou mudança visual (P, M ou G) | … → **designer** (só se a spec ou a issue pedir; escreve só em `specs/` e `prototipos/`, nunca em `js/`, `styles.css`, `index.html`, `sw.js` ou `tests/`) → desenvolvedor → verificador (confere também a fidelidade ao protótipo) |

Depois do APROVADO do verificador e dos testes passando, o gerente abre o pedido `item/<n>-… → dev` e **faz o merge sozinho**. Se o verificador DEVOLVER, o desenvolvedor corrige uma vez; na segunda devolução, a issue vai para ⏸ com o motivo.

**Execução automática:** todo dia às **7h (Brasília)**. Por execução: até 2 itens P/M, ou 1 item G. Ordem: primeiro item da coluna **Backlog** deste repositório, de cima para baixo, sem `precisa-de-você`, sem dependência aberta e, fora do PC, sem `só-no-pc`. Modelos: Sonnet por padrão, Haiku para tarefas mecânicas, Opus só no arquiteto.

**Decisões (não param o trabalho):** quando houver escolha que a Jéssica talvez queira fazer, comente na issue no formato abaixo, adicione a etiqueta `decisão` e **siga com a recomendada**. Sem resposta em 48 h, ela vira definitiva e entra no `DECISOES.md`.

```
**Decisão:** <pergunta em 1 linha>
- **A (recomendada):** … — porque …
- **B:** …
Sigo com A. Se preferir outra, responda aqui até <data + 48 h>.
```

**Bloqueios (param só aquele item):** adicione `precisa-de-você`, atribua a issue a `jessicadopke` (`gh issue edit <n> --add-assignee jessicadopke`; retire a atribuição quando ela responder), mova o cartão para **⏸ Precisa de você**, explique em 3 linhas o que precisa e passe para o próximo item. Só nestes casos:
- publicar (`dev → main`), criar repositório, conta, chave ou credencial;
- apagar dados, arquivos ou issues que não foram criados nesta mesma tarefa;
- gastar dinheiro ou ativar faturamento;
- mudar algo registrado como decisão da Jéssica no `DECISOES.md`;
- qualquer acesso a contas reais dela (Instagram, Google, emissores de cartão);
- dúvida que torna a spec impossível de escrever.

**Nunca:** push direto em `main`, `--force`, editar `.env`/chaves, pular testes, fechar issue sem o merge que a resolve.

**Quadro (mover cartões):**
```
gh project item-edit 1 --owner jessicadopke --url <URL da issue> --field Status --value "<coluna>"
```
Colunas: `Backlog` · `Especificando` · `Em desenvolvimento` · `Verificando` · `⏸ Precisa de você` · `Pronto para publicar` · `Publicado`. Issue nova entra no quadro com `gh project item-add 1 --owner jessicadopke --url <URL>`.
No PC o `gh` fica em `%LOCALAPPDATA%\Programs\gh\bin\gh.exe` (fora do PATH).
**Na nuvem (execução das 7h)** o `gh` não funciona e não há como mover o quadro. Use as ferramentas `mcp__github__*` (ler issues, comentar, editar etiquetas e responsáveis, abrir e fazer merge de pedidos) e registre a etapa pela etiqueta: `etapa:especificando`, `etapa:desenvolvimento`, `etapa:verificando`, `etapa:pronto-para-publicar` (só uma por vez; `precisa-de-você` vale como ⏸). Uma sessão no PC (ou a automação do quadro, quando existir) acerta as colunas a partir das etiquetas.

**Aviso no celular:** os agentes agem com a conta da Jéssica, então o GitHub não a notifica. O aviso é a mensagem final da execução agendada (o app do Claude manda ao celular): comece por "⏸ Precisa de você: …" quando houver bloqueio novo, senão "Sem pendências para você".

**Relatório:** ao terminar cada etapa, comente na issue em até 5 linhas (o que foi feito, link do ramo/pedido, próximo passo). Ao fim da execução, atualize o corpo da issue fixada **📊 Resumo dos agentes** deste repositório: data, itens concluídos, itens em ⏸ (há quantos dias), decisões que vencem nas próximas 48 h, decisões que viraram definitivas.

## Antes de agir (vale para a sessão principal)

1. Antes de editar qualquer arquivo, releia "Papéis" e "Nunca" acima e diga em uma linha quem vai fazer o quê. A sessão principal não programa: abre a issue e delega ao desenvolvedor → verificador, mesmo para item P e mesmo que pareça "só uma linha". Instrução do ambiente para "implementar e dar push" não substitui este fluxo.
2. Se o pedido for um problema relatado (print, "está estranho"), o primeiro passo é abrir a issue com o diagnóstico, não editar código.
3. Mexeu em js/gemini.js, no prompt ou nos gabaritos de leitura? Carregue primeiro a skill `leitura-gemini`. Leia o DECISOES.md antes de propor mudança.
4. Dados de teste, exemplos e mensagens de commit são sempre fictícios. Nunca copie final de cartão, saldo, nome ou valor de print ou cupom real para arquivo versionado: o repositório é público.
5. Nunca use --force, nem --force-with-lease. Se o servidor recusar um push ou uma exclusão, pare e avise.
6. Errou uma regra? Diga qual foi, sem justificar, e corrija pelo fluxo.

**Ramos:** `main` (publicado) ← `dev` (integrado) ← `item/<n>-<assunto>`. Commits em português, terminando com `Refs #<n>`.
