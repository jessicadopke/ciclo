# Ciclo · histórico de versões

*Do crédito ao próximo crédito.* Até a versão 1.3.0 o app se chamava "Carteira de Vales".

O app segue o Versionamento Semântico (`MAJOR.MINOR.PATCH`):

- **MAJOR:** mudança que quebra a compatibilidade, por exemplo um formato de backup antigo que deixa de abrir.
- **MINOR:** função nova, compatível com os dados e backups já existentes.
- **PATCH:** só correção ou ajuste pequeno.

A versão em uso aparece em **Ajustes**, no rodapé.

## 1.14.1 — 26/10/2026

### Corrigido
- **App preso na tela de abertura:** em alguns casos, o Ciclo ficava na tela de abertura com o anel girando para sempre. Agora, se o app não abrir em cerca de 10 segundos, aparece uma mensagem com o botão **Atualizar arquivos**. Esse botão só troca os arquivos do app: cartões, extratos, fotos e senhas continuam como estavam.
- **Dados que demoram para abrir:** se o app não conseguir abrir os seus dados (por exemplo, quando o Ciclo está aberto em outra janela), aparece o aviso "Feche outras janelas do Ciclo e abra de novo". Seus dados não são apagados.
- **Atualização mais segura:** depois de atualizar, a página, os estilos e os arquivos do app vêm todos da mesma versão, para não misturar arquivos antigos e novos.

## 1.14.0 — 25/10/2026

### Novo
- **Animação na abertura:** ao abrir o app, aparece o ícone do Ciclo em movimento: a bolinha laranja chega ao anel e o anel gira. Quando o app está pronto, a animação some. Ela não deixa a abertura mais lenta. Se o celular estiver com "remover animações" ligado, o ícone aparece parado.

### Corrigido
- **Borda no ícone da abertura:** o ícone do app não mostra mais uma borda estranha na tela de abertura. Para ver o ícone novo, pode ser preciso remover o atalho do Ciclo da tela inicial e instalar o app de novo.

## 1.13.1 — 25/10/2026

### Corrigido
- **Cupom de vale impresso como crédito:** algumas maquininhas imprimem "crédito" ou "débito" mesmo quando o cartão usado é um vale. Se o final desse cartão no cupom é o de um vale seu, o app agora lança o valor como vale, com o cartão escolhido e o saldo descontado. Cartão de banco comum continua sendo lançado como crédito.
- **Aviso na conferência:** quando isso acontece, a tela de conferência avisa o que foi feito e põe o valor em "Pago com vale", para você conferir ou mudar.

## 1.13.0 — 25/10/2026

### Mudou
- **Saldo calculado pelos lançamentos:** o saldo de cada cartão passa a ser a soma do saldo inicial com os lançamentos, em vez de um número guardado que podia ficar fora do lugar. Depois de atualizar, vale conferir o saldo dos seus cartões.
- **Apagar lançamento:** ao apagar, o app guarda uma marca de "apagado" em vez de sumir com o registro de vez. Na tela, o lançamento some do mesmo jeito.
- **Números de identificação novos:** lançamentos e cartões criados daqui em diante ganham códigos mais longos e aleatórios, para não se repetirem entre aparelhos. Os que já existem continuam funcionando.
- Nada muda na tela e o formato do backup continua o mesmo.

### Por dentro
- Esta versão é a base da futura sincronização com a Planilha Google: as funções de mesclar, carimbar a última mudança e calcular o saldo ficam em `js/sync.js`. A sincronização ainda não está ligada.

## 1.12.0 — 24/10/2026

### Novo
- **Recorte automático da foto do cupom:** o app pode achar o papel do cupom na foto e recortar só ele antes da leitura pelo leitor do celular. Fica em Ajustes e vem desligado. Com a opção ligada, o app recorta sozinho e mostra uma miniatura do recorte depois da leitura, com o botão "Ler de novo sem recorte". Com a opção desligada, antes de ler o app mostra o contorno para você conferir e arrastar os 4 cantos, se quiser.

### Mudou
- **Código interno organizado em módulos:** o código do app foi dividido em vários arquivos menores. Para quem usa, nada muda: as telas, os dados e os backups são os mesmos. Como os arquivos são novos, o celular baixa tudo de novo na próxima abertura depois da atualização.

## 1.11.0 — 23/10/2026

### Novo
- **Backup no Google Drive:** em Ajustes → Backup no Drive, você liga o Drive uma vez e o app guarda sozinho uma cópia dos dados numa pasta "Ciclo – backups" do seu Drive, no máximo a cada 7 dias ou depois de 30 lançamentos novos. Também dá para salvar agora ou restaurar uma cópia da lista. O backup do Drive vai sem as fotos, a menos que você marque "Incluir fotos". Os dados continuam só no celular; o Drive só guarda o arquivo que você mandou.
- **Exportar o extrato em planilha:** o botão "Exportar planilha" na aba Extrato gera um arquivo CSV com os lançamentos da busca que está na tela.
- **Gráficos do período:** no cartão e na aba Extrato, gráficos mostram para onde foi o dinheiro: gastos por categoria, pelas lojas onde mais se gastou e por titular. Cada gráfico diz quanto mudou em relação ao período anterior. Os totais batem com o extrato.
- **Aviso do dia do crédito:** o Início mostra um bloco "Créditos previstos" com os créditos de hoje, de amanhã e dos próximos 3 dias, com o botão "Confirmar valor" para o que já caiu. Em Ajustes, há uma opção experimental de notificação no dia do crédito; o celular decide quando ela chega, então não é garantido.

### Mudou
- **Lembrete de backup:** com o Drive funcionando, o aviso de backup atrasado some do Início. Se o Drive falhar por mais de 7 dias, o aviso aparece de novo, dizendo que o backup no Drive não está funcionando.

## 1.10.0 — 22/10/2026

### Novo
- **Andamento da leitura com o Gemini:** a tela mostra o modelo que está lendo e o tempo decorrido. Quando um modelo falha ou demora, ela avisa a troca (por exemplo, "gemini-flash-latest: sobrecarregado. Tentando gemini-flash-lite-latest…").
- **Modelo do Gemini por lista:** em Ajustes → Gemini → Avançado, o modelo é escolhido numa lista dos modelos que a sua chave pode usar, buscada no Google. A mesma tela mostra qual modelo fez a última leitura e quantas leituras e erros de cota (429) houve nos últimos 30 dias, neste celular.
- **Lembrete de backup:** além de avisar quando o último backup tem mais de 30 dias, o Início avisa quando há 30 lançamentos novos desde ele.

### Mudou
- **Telas estreitas e fonte grande:** no cadastro de cartão e nos outros formulários em duas colunas, as caixas lado a lado ficam alinhadas mesmo quando um rótulo quebra em duas linhas. Em telas com menos de 360 px, cada campo ocupa uma linha. O rótulo "Saldo depois desta compra" virou "Saldo após a compra".
- **Extrato em tela estreita:** o nome da loja pode ocupar duas linhas, e os botões "foto" e "×" ficam um sobre o outro. O saldo impresso aparece como "saldo R$ …".
- **Acessibilidade:** os rótulos das abas, o rodapé e os botões "foto" e "×" passaram a ter contraste suficiente para leitura (eram cinza-claro), e os botões pequenos ganharam área de toque mínima de 32 px.

### Corrigido
- **Final do cartão errado na leitura com o Gemini:** num comprovante com o número mascarado (por exemplo `608812******4821`), o Gemini podia devolver os 4 **primeiros** dígitos (`6088`, que identificam a rede do cartão) como se fossem o final. Agora o Gemini copia o número como está impresso, e o app tira o final dos dígitos que vêm depois da máscara. Um "final" igual ao começo do número é descartado.
- **Final do cartão no leitor do celular:** reconhece `************4321`, `**** **** **** 4321`, `XXXX4321` e `FINAL 4321`, mesmo quando o leitor troca o `*` por `x`, `+` ou `#`.
- **Leitor do celular:** a forma de pagamento "CARTAO TEF" da NFC-e passa a contar como vale quando o cupom traz o comprovante de um cartão de benefício. Antes ela aparecia como "outra forma".
- **Leitor do celular:** com cartões de tipos diferentes no mesmo cupom (alimentação e refeição), o tipo do cartão novo fica em aberto, em vez de vir errado para um deles.

### Por dentro
- Os emissores de cartão (nome, cor, sigla e como reconhecer cada um) ficam num arquivo só, `js/issuers.js`. Um emissor novo entra só ali.
- A escolha do cartão pelo cupom e o aviso de cartão novo saíram da tela de conferência para `js/match.js`, como funções que podem ser testadas.
- **Testes automáticos** em `tests/`, rodados com `node --test`: cupons reais anonimizados, respostas salvas do Gemini e escolha do cartão, incluindo os defeitos já corrigidos.
- O código passou a ser publicado por `git push`, com tag e release a cada versão.

## 1.9.0 — 22/10/2026

### Novo
- **Mais emissores de cartão:** Volus, Valecard, Up Brasil (ex-Policard), Verocard, Greencard, Nutricash e GoodCard, no cadastro e na leitura de cupons e cartões (Gemini e leitor do celular).
- Quando o emissor lido no cupom não está na lista, o nome dele vai para o **Nome do cartão** do cartão novo, mesmo com o emissor em "Outro".
- **Titular do cartão no cupom:** se o comprovante imprimir o nome do titular, ele preenche o **Titular** do cartão novo e ajuda a identificar o cartão cadastrado (basta o primeiro nome bater).

### Corrigido
- **Modelos de reserva do Gemini:** o `gemini-2.5-flash` deixou de existir na API (erro 404). A reserva agora é o `gemini-flash-lite-latest`, e um modelo que dá 404 não é tentado de novo até o app ser reaberto.
- A tela de conferência do cupom falhava com a carteira vazia, e a leitura caía no leitor do celular.

## 1.8.5 — 21/10/2026

### Corrigido
- **Cadastrar cartão a partir do cupom:** o emissor vinha como "Outro" mesmo quando o comprovante dizia, por exemplo, "VR BENEFICIOS VOUCHER". Agora o Gemini copia a linha do comprovante que identifica o cartão, e o app reconhece o emissor por ela. A adquirente da maquininha (Cielo, Rede, Stone etc.) não é confundida com o emissor.
- O **tipo** do cartão novo (alimentação, refeição ou multibenefício) vem do comprovante quando ele diz o tipo, por exemplo "ALELO REFEICAO". Só quando o comprovante não diz, o app usa a categoria da loja, como antes. Vale tanto para o Gemini quanto para o leitor do celular.

## 1.8.4 — 21/10/2026

### Corrigido
- **Gemini sem resposta em 30 segundos:** o modelo padrão (`gemini-flash-latest`, hoje da geração 3) ainda "pensava" antes de responder, e o app esperava só por ele. Agora:
  - o app pede ao Gemini o raciocínio **mínimo**, o que deixa a resposta bem mais rápida;
  - se o modelo escolhido não responder em 12 segundos, um modelo de reserva começa **ao mesmo tempo**, e vale a primeira resposta que chegar. O limite total continua sendo 30 segundos;
  - em "Como foi lido", a tentativa que ficou para trás aparece como "cancelado".

## 1.8.3 — 20/10/2026

### Corrigido
- **Espera longa quando o Gemini não responde:** cada modelo do Gemini podia esperar até 25 segundos, e o app tentava três modelos. Agora a espera pelo Gemini é de no máximo 30 segundos **no total**. Se ele não responder nesse tempo, o app passa direto para o leitor do celular, sem tentar outros modelos.

### Novo
- **"Como foi lido"**, na tela de conferência do cupom, mostra cada tentativa do Gemini (modelo, resultado e tempo), ou por que ele não foi usado (sem chave, desligado, sem internet), e o tempo total da leitura. Serve para entender uma leitura demorada ou que não usou o Gemini.

## 1.8.2 — 20/10/2026

### Mudou
- **Leitura de cupom mais rápida:**
  - **Com o Gemini:** o app pede uma resposta direta, sem o modo de "raciocínio" do modelo, e envia uma foto menor (1600 px), suficiente para ler o cupom. A resposta chega bem mais rápido.
  - **No celular:** a foto é lida com no máximo ~3,5 MP, em vez de até 3200 px de lado. Sem o Gemini, o leitor já começa a carregar enquanto a câmera está aberta.
  - Se o Gemini não responder em 25 segundos, o app passa para o leitor do celular, em vez de ficar esperando.
- **Cartão que não está na carteira:** além do final e do emissor, o app confere o **saldo impresso**. Quando ele não fecha com nenhum cartão cadastrado, a conferência avisa que pode ser um cartão novo e oferece **Cadastrar agora** ou **É o (cartão sugerido)**, em vez de só mostrar um "cartão provável".
  - Quando o cartão sugerido vem só de pistas fracas (mesmo emissor ou loja), aparece também **Cadastrar outro cartão**.

### Corrigido
- **"O Gemini está fora do ar":** quando o modelo do Gemini está sobrecarregado ou sem cota (erros 503 e 429 do Google), o app tenta outros modelos do Gemini antes de desistir. A mensagem agora diz qual foi o erro.
- Com um cartão errado sugerido e o saldo do cupom diferente, o app podia marcar sozinho "usar o saldo do cupom" e ajustar o saldo do cartão errado. Agora o vale fica sem cartão até você escolher.

## 1.8.1 — 20/10/2026

### Mudou
- Os textos da configuração do Gemini falavam só em cupons, mas desde a 1.8.0 ele também lê cartões. A seção em Ajustes passa a se chamar **Leitura de fotos**, e a tela do Gemini explica que cupons e cartões (frente do cartão ou print do app do emissor) são enviados ao Google quando ele está ligado.

## 1.8.0 — 20/10/2026

### Novo
- **Aviso de cartão não cadastrado:** quando o cupom mostra um emissor ou final que não existe na carteira (por exemplo, "Alelo final 9999"), a conferência avisa e oferece **Cadastrar agora**.
  - O cadastro abre ali mesmo, sem perder o cupom. Emissor, final e tipo já vêm preenchidos, e você confirma o nome e o titular.
  - O saldo inicial é calculado para que, depois desta compra, o cartão fique com o saldo impresso no cupom.
  - O cartão novo já fica escolhido para aquele vale.
- **Cadastrar cartão por foto:** no cadastro de cartão, os botões **Foto do cartão** (câmera) e **Print do app do emissor** (galeria) preenchem emissor, tipo, titular, final e, no print, o saldo atual.
  - Usa o Gemini, se estiver ligado. Senão, ou se ele falhar, usa o leitor do celular.
  - **Privacidade:** o app guarda só os 4 últimos dígitos do cartão, nunca o número completo, e não guarda a imagem. Com o Gemini ligado, a foto vai para o Google. Fotografe só a frente do cartão, nunca o verso, onde fica o código de segurança.

### Mudou
- Quando o cupom aponta para um cartão que não está na carteira, o app deixa o vale **sem cartão escolhido**, em vez de sugerir um cartão parecido que pode estar errado. Para salvar, é preciso escolher um cartão ou cadastrar o novo.

## 1.7.0 — 20/10/2026

### Novo
- **Atualizar o app pelo próprio app:**
  - Em **Ajustes → Sobre o app**, o botão **Buscar atualização** mostra a versão instalada e verifica se há uma mais nova.
  - Quando há, aparece **Atualizar para a versão X**, que baixa a versão nova e reinicia o app.
- **Aviso automático:** ao abrir o app com internet (e de novo quando você volta a ele depois de algumas horas), o Início mostra "A versão X do Ciclo está disponível", com o botão **Atualizar**.
- **Recarregar o app:** baixa de novo todos os arquivos, para quando algo parecer desatualizado.
- Atualizar ou recarregar **não mexe** em cartões, extratos, fotos e senhas. Só a cópia offline do programa é trocada.
- Novo arquivo `version.json` na raiz do site, com a versão publicada.

## 1.6.2 — 20/10/2026

### Corrigido
- **Chave do Gemini recusada sem motivo:** ao colar uma chave válida, o app podia dizer "Essa chave não parece válida". A checagem de formato feita no próprio app era rígida demais e foi removida.
  - O app agora limpa sozinho o que costuma vir junto ao copiar: espaços, quebras de linha, aspas, caracteres invisíveis e um `GEMINI_API_KEY=` na frente.
  - Quem decide se a chave vale é o Google, no "Testar e salvar". Se ela estiver errada, aparece a mensagem dele.

## 1.6.1 — 20/10/2026

### Mudou
- **"Ler cupom" abre a câmera direto:** antes abria a galeria do celular. Agora vai para a câmera traseira, para fotografar o cupom na hora.
- **Foto já tirada:** para ler um cupom que já está na galeria, use o link "Ler cupom de uma foto da galeria", que aparece no botão **+** e na tela do cartão. Pela galeria dá para escolher várias fotos de uma vez.

## 1.6.0 — 20/10/2026

### Novo
- **Leitura de cupons com o Gemini (opcional):** em Ajustes → Leitura de cupons → Gemini, você cola uma chave de API do Google AI Studio e liga a função.
  - A foto vai para o Gemini, que devolve loja, CNPJ, data, total e cada forma de pagamento. Para cada vale, vêm também o emissor, o final do cartão e o saldo impresso.
  - Costuma acertar mais que o leitor do celular, principalmente em cupom térmico apagado.
  - **Reserva automática:** sem internet, com a chave recusada ou com o limite de uso atingido, o app avisa e lê a foto no próprio celular, como antes.
  - "Testar e salvar" confere a chave antes de guardar. O teste não gasta cota de leitura.
  - A tela de conferência mostra "Lido pelo Gemini" ou "Lido no celular". Em "Ver resposta do Gemini" dá para ver exatamente o que foi lido.

### Corrigido
- Numa compra paga com vários vales, o final do cartão impresso no comprovante de um vale podia fazer o app sugerir esse cartão também para os outros. Agora cada vale usa só as pistas dele.

### Privacidade
- Com o Gemini ligado, a foto do cupom sai do celular e vai para o Google. No plano gratuito, o Google pode usar o que é enviado para melhorar os produtos dele. Ativar o faturamento no AI Studio impede esse uso.
- A chave fica guardada só no celular, não entra no backup e é enviada ao Google no cabeçalho da requisição, nunca no endereço.
- Com o Gemini desligado (o padrão), nada muda: tudo continua só no celular.

## 1.5.0 — 16/10/2026

### Novo
- **Tema:** em Ajustes → Aparência → Tema dá para escolher Automático (segue o celular), Claro ou Escuro. A escolha vale para este celular e é aplicada antes de a tela aparecer, sem piscar.
- **README** no repositório, com o que o app faz, como instalar e como publicar uma versão nova.

### Mudou
- **Tudo passa a se chamar Ciclo:**
  - repositório `jessicadopke/ciclo`;
  - endereço https://jessicadopke.github.io/ciclo/;
  - banco de dados interno `ciclo`;
  - backups marcados como `ciclo`.
- **O endereço antigo** (`/carteira-vales/`) deixa de funcionar.

### Compatibilidade
- Se o banco antigo (`carteira-vales`) existir no celular, os dados são copiados para o novo na primeira abertura, e o app avisa "Seus dados foram trazidos da versão anterior".
- Backups feitos em versões anteriores continuam podendo ser restaurados.

### Removido
- Arquivos que sobraram no repositório: a fonte antiga (Plus Jakarta Sans) e os arquivos vazios usados para criar pastas.

## 1.4.0 — 16/10/2026

### Novo
- **Identidade visual "Ciclo":** o app passa a se chamar Ciclo, com a frase "do crédito ao próximo crédito".
  - **Símbolo:** um anel aberto (o período entre dois créditos) com um ponto âmbar marcando o dia em que o crédito cai.
  - **Cores:** petróleo como cor da marca, menta para os realces e âmbar como destaque pontual. No modo escuro, a menta vira a cor principal.
  - **Fonte:** Outfit, embutida no app (funciona offline).
  - **Ícone:** novo, também na versão para o recorte redondo do Android. A tela de abertura do app instalado fica em petróleo.
  - **Cartão de saldo:** ganha o anel e o ponto âmbar do símbolo.
- Os backups novos se chamam `ciclo-backup-AAAA-MM-DD.json`.

### Compatibilidade
- Os dados guardados no celular e os backups feitos nas versões anteriores continuam funcionando sem nenhuma ação.
- O endereço do app continua o mesmo.
- Num celular com o app já instalado, o ícone e o nome novos podem levar alguns dias para aparecer na tela inicial. Isso depende do Android. Desinstalar e instalar de novo resolve na hora, mas faça um backup antes.

## 1.3.0 — 16/10/2026

### Novo
- **Visual novo:** a fonte Plus Jakarta Sans vem embutida e funciona offline. As cores são neutras, com verde só como destaque, e os modos claro e escuro foram revisados.
- **Cartão de saldo:** no topo da tela inicial, com o total, os gastos do mês e os créditos recebidos.
- **Barra de abas embaixo:** Início, Extrato, Cofre e Ajustes, com um botão central **+** para lançar gasto, ler cupom, registrar crédito ou cadastrar cartão.
- **Aba Extrato:** todos os lançamentos, com busca por loja, categoria, cartão, titular, valor ou data, e o total de gastos e créditos do resultado.
- **Aba Cofre:** mostra o estado do cofre e quais cartões têm senhas guardadas.
- **Aba Ajustes:** backup, restauração, fotos, aparência, troca da senha mestra e versão. Substitui o antigo botão "Mais".
- **Esconder valores:** o botão de olho no topo desfoca todos os saldos e valores, para usar o app em público.
- **Transições:** troca de tela animada, janelas que sobem e descem com efeito de mola, resposta ao toque nos botões e entrada suave das listas. Quem desativa as animações no Android não vê os efeitos.
- **Cartões grandes:** degradê na cor do emissor, a mesma da sigla na lista.
- **Tela do cartão:** atalhos para Gasto, Ler cupom, Crédito e Corrigir.

### Corrigido
- O botão "Cancelar" das janelas deixava uma entrada sobrando no histórico, e o "voltar" do Android precisava ser tocado duas vezes.

## 1.2.0 — 16/10/2026

### Novo
- **Crédito com valor ou dia variáveis:** no cadastro do cartão, o valor do crédito pode ser "fixo" ou "varia", e o dia pode ser "fixo", "varia" ou "não controlar".
  - Com valor variável, o aviso de crédito pede o valor, já preenchido com o último recebido.
  - Com dia variável, cada período vai de um crédito registrado até o seguinte. O próximo crédito é previsto pela média de dias entre os créditos anteriores e aparece marcado como previsão.
- **Divisão do pagamento:** uma compra pode ser paga com vários vales e também com cartão de crédito, cartão de débito, Pix ou dinheiro.
  - Cada vale vira um lançamento, ligado aos outros como "parte de uma compra de R$ X".
  - As outras formas ficam registradas, mas não mexem no saldo dos vales.
  - A tela mostra quanto falta para fechar o total e o saldo de cada vale depois da compra.
- **Leitor de cupom:** lê todas as linhas de "Forma de pagamento" da NFC-e e preenche a divisão. Com vários comprovantes de vale na mesma foto, usa todos os saldos e finais impressos para identificar cada cartão.
- **Cupom sem saldo impresso:** a revisão mostra o saldo que o cartão terá depois de descontar o valor pago.
- **"Adicionar crédito"** tem a opção "é o crédito do benefício", que começa um novo período. Desmarque para estornos e devoluções.
- Número da versão no rodapé de **Mais**.

### Corrigido
- Não dá mais para voltar a períodos anteriores ao primeiro lançamento do cartão.
- A foto de um cupom usado por mais de um vale só é apagada quando todas as partes da compra são apagadas.

## 1.1.0 — 16/10/2026

### Novo
- Lista compacta de cartões, com busca e grupos por titular (pensada para 30 ou mais cartões).
- Aviso único para registrar vários créditos de uma vez.
- Seletor de cartão com busca e sugestões.
- Identificação do cartão no cupom pelo saldo impresso e pela loja onde o cartão já foi usado (CNPJ).
- Fotos de cupom menores (tons de cinza, cerca de 100 KB) e opção de apagar fotos antigas.

### Corrigido
- O app não trava mais quando fica aberto em duas abas ao mesmo tempo.

## 1.0.0 — 16/10/2026

- Primeira versão publicada: cartões de vários titulares, períodos pelo dia do crédito, leitura de cupom fiscal no próprio celular, cofre de senhas criptografado e backup.
