# Preços automáticos dos fornecedores

Os preços de Link, ScanSource, Pauta, BringIT, Ingram etc. mudam todo dia ou toda semana. Em vez de digitar custo por custo, o sistema **recebe a planilha do fornecedor e atualiza o catálogo sozinho**. A tela fica em **Preços automáticos** (menu).

## Como funciona

1. **Uma vez por fornecedor** (manual, 2 minutos): em **Produtos → Importar planilha**, envie a primeira planilha dele e confira as colunas (código, preço…). O sistema **memoriza** as colunas e cadastra os produtos.
2. **Depois, automático.** A planilha chega por um destes caminhos (pode usar mais de um por fornecedor):

| Caminho | Quando usar | Como |
|---|---|---|
| **Link** | A planilha fica num endereço fixo (Google Planilhas, Drive, Dropbox, link de download do fornecedor) | Cole o link em **Preços automáticos → Configurar → Link da planilha**. O sistema baixa **todo dia**. |
| **Envio** | O fornecedor manda a planilha **por e-mail** | Uma automação encaminha o anexo para o sistema (veja abaixo). Atualiza na hora em que o e-mail chega. |
| **Manual rápido** | Qualquer outro caso | **Preços automáticos → Configurar → Enviar planilha agora** (sem a tela de conferência). |

Aceita `.xlsx` e `.csv` (UTF-8 ou Windows-1252, separador `;` `,` ou tabulação).

## O que acontece com cada linha da planilha

- **Preço igual ao que já temos:** só renova a validade do custo (nenhuma linha nova no histórico).
- **Preço diferente, dentro do limite:** vira um custo novo no histórico e passa a valer na hora. Vale tanto para queda quanto para **aumento** (o preço novo de um fornecedor substitui o anterior dele).
- **Preço muda mais que o limite (padrão 30%):** **não entra sozinho.** Fica em *Aguardando sua aprovação* (promoção? erro do fornecedor? coluna errada?). Uma pessoa aprova ou descarta. O limite é ajustável por fornecedor.
- **Código que não existe no catálogo:** não é cadastrado sozinho; é só listado no histórico para você cadastrar via **Importar planilha**.
- **Planilha “quebrada”** (mais da metade das linhas com erro, ou as colunas mudaram de nome): **nada é gravado** e o histórico mostra o motivo.
- Se o fornecedor para de mandar, o custo **vence** (validade padrão: 7 dias) e o produto sai dos orçamentos novos até voltar a ser atualizado. A lista de fornecedores marca em vermelho quem está há 2+ dias sem atualizar.

## Receber por link (agendador)

O agendador chama `/api/cron/precos` uma vez por dia (06:00, horário de Brasília) e baixa o link de cada fornecedor. Ele também expira orçamentos vencidos.

- **Vercel:** já está no `vercel.json`. Basta definir a variável `CRON_SECRET` (mínimo 16 caracteres; gere com `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). A Vercel envia essa senha sozinha. No plano gratuito (Hobby) o agendador roda no máximo 1 vez por dia.
- **VPS / Docker / computador:** defina `CRON_SECRET` e agende uma chamada diária, por exemplo com `cron`:
  ```bash
  0 9 * * * curl -fsS -H "Authorization: Bearer SEU_CRON_SECRET" https://orcamentos.suaempresa.com.br/api/cron/precos
  ```
  (no Windows, o Agendador de Tarefas com `curl.exe` faz o mesmo).
- **Link com senha:** se o link exigir login, informe em *Login do link* no formato `Nome: valor` (ex.: `Authorization: Bearer abc123`). É guardado criptografado e só vai para o endereço configurado.
- Só links `https://` públicos são aceitos (nunca endereços internos).

## Receber por e-mail (envio)

1. Em **Preços automáticos → Configurar** do fornecedor, clique **Gerar chave**. Copie a chave (ela **não aparece de novo**; se perder, gere outra).
2. O endereço de envio é `https://SEU-SITE/api/precos/{id do fornecedor}` (a tela mostra o comando pronto).
3. Ligue o e-mail do fornecedor a esse endereço com uma das opções:

**Google Apps Script** (grátis; para Gmail/Google Workspace). Crie um filtro/etiqueta `precos-ingram` para os e-mails do fornecedor e um script com gatilho de tempo (a cada hora):

```js
const URL = "https://SEU-SITE/api/precos/1";   // 1 = id do fornecedor
const CHAVE = "tm_...";                        // chave gerada na tela
function enviarPrecos() {
  const label = GmailApp.getUserLabelByName("precos-ingram");
  for (const th of label.getThreads()) {
    for (const msg of th.getMessages()) {
      if (!msg.isUnread()) continue;
      for (const anexo of msg.getAttachments()) {
        if (!/\.(xlsx|csv)$/i.test(anexo.getName())) continue;
        UrlFetchApp.fetch(URL, {
          method: "post",
          headers: { Authorization: "Bearer " + CHAVE, "X-Filename": anexo.getName() },
          payload: anexo.copyBlob().getBytes(),
          contentType: "application/octet-stream",
          muteHttpExceptions: true,
        });
      }
      msg.markRead();
    }
  }
}
```

**Zapier / Make / Power Automate:** gatilho “novo e-mail com anexo” → ação “HTTP POST” para o endereço, cabeçalho `Authorization: Bearer SUA_CHAVE`, corpo = o arquivo anexo (ou `multipart/form-data` com o campo `arquivo`).

A resposta (JSON) diz o que foi feito; erro de planilha volta com código 422 e o motivo.

> Segurança: errar a chave várias vezes bloqueia o IP por 15 minutos. **Desativar chave** na tela corta o acesso na hora. Todas as execuções (de qualquer caminho) ficam no **Histórico** da tela.

## Aprovação do orçamento (interna e do cliente)

- **Atualizar todos os preços:** no orçamento em elaboração, um botão traz o custo vigente do catálogo para todos os itens de uma vez.
- **Aprovação interna** (opcional; ligue em *Regras e configurações → Exigir aprovação…*): o vendedor clica **Pedir aprovação**; o sistema **atualiza os preços na hora** e trava a edição. O administrador vê, na lista de orçamentos, “aguardando a sua aprovação”, confere o que mudou de preço e clica **Aprovar e marcar como enviado** (ou **Devolver para ajustes**, com recado). Se o catálogo mudar depois do pedido, a aprovação pede para atualizar de novo (ele nunca aprova um preço que já não vale). Editar um orçamento já aprovado cancela a aprovação.
- **Link do cliente:** ao marcar como enviado, o orçamento ganha um link (`/p/…`, sem login, em tema claro, com PDF). O cliente informa o nome e clica **Aprovar** ou **Recusar** (com motivo). Ficam registrados nome, data/hora e IP. O link só aprova enquanto a proposta está dentro da validade; **Gerar link novo** invalida o anterior. Os preços do link são os do envio (congelados), nunca o custo nem a margem.

## Problemas comuns

| Mensagem | O que fazer |
|---|---|
| “As colunas deste fornecedor ainda não foram configuradas” | Faça a importação manual uma vez (Produtos → Importar planilha). |
| “As colunas da planilha mudaram…” | O fornecedor renomeou colunas. Refaça o mapeamento na importação manual. |
| “…linhas com erro. O formato da planilha pode ter mudado” | Abra a planilha: preço em texto estranho, coluna deslocada? Corrija o mapeamento ou peça o arquivo correto. |
| “O fornecedor recusou o acesso” | O link/login expirou; gere um novo no portal do fornecedor e atualize na tela. |
| Muitos “Não cadastrados” | São produtos que o catálogo ainda não tem: use **Importar planilha** para cadastrá-los. |
