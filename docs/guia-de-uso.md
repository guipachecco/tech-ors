# Guia de uso

## Entrar (senha + 2FA)

O acesso tem **duas etapas**: e-mail e senha, depois um código de 6 dígitos do **Google Authenticator**.

- **Primeiro acesso:** depois da senha o sistema mostra um QR code. No celular, abra o Google Authenticator → **+** → escanear o QR. Digite o código que o app mostrar. Em seguida aparecem **10 códigos de recuperação**: guarde-os (cada um vale uma vez e **não são mostrados de novo**).
- **Próximos acessos:** senha + código atual do app (muda a cada 30 segundos).
- **Perdeu o celular?** Use um código de recuperação ("Usar código de recuperação" na tela do código) ou peça a um administrador para **Usuários → Redefinir 2FA**; no próximo login a pessoa configura de novo.
- Sem nenhum administrador conseguindo entrar: no servidor, rode `npm run reset-2fa -- email@empresa.com`.

## Rotina semanal (preços mudam toda semana)

1. **Produtos → abra o produto → "Atualizar custo".** Informe o fornecedor, o custo (ex.: `1.234,56`), o link da página do produto e a validade.
   - A validade vem pré-preenchida (padrão da configuração, ou da regra da categoria — ex.: 3 dias para SSD e memória). Pode ser alterada.
   - Cada atualização cria uma nova linha no histórico; nada é sobrescrito.
2. Produtos com **custo vencido** aparecem em vermelho na lista e **não entram em orçamentos** até o custo ser atualizado.

## Importar a planilha do fornecedor

Quando o fornecedor manda os preços em .xlsx: **Produtos → Importar planilha**.

1. Escolha o **fornecedor** e envie o arquivo (até 5 MB e 2.000 linhas). Nada é gravado ainda.
2. Confira as **colunas**: o sistema sugere (código, descrição, marca, preço, link…); ajuste se precisar. Só **código** e **custo** são obrigatórios. Para produtos novos informe a **categoria** e o **fabricante** (coluna ou valor padrão). A escolha fica salva para o fornecedor: na próxima planilha dele já vem pronta.
3. Veja a **pré-visualização**: *Novo* (cadastra o produto), *Atualiza* (custo diferente, mostra o anterior), *Reconfirma* (mesmo custo — renova a validade) e *Erro* (não é importado, com o motivo). Desmarque o que não quiser e confirme. Tudo é gravado de uma vez.

O produto é reconhecido pelo **código do fornecedor** (de importações anteriores) ou pelo **SKU interno**. Cada importação adiciona um custo ao histórico; nada é sobrescrito. Quem importa precisa de permissão para alterar custos.

## Montar um orçamento

1. **Orçamentos → Novo orçamento →** escolha o cliente.
2. Busque o produto (SKU, modelo, fabricante, descrição) e clique em **Adicionar**.
3. Ajuste quantidade e desconto (%) na própria linha — o valor é salvo ao sair do campo. Informe o **frete** nos totais.
4. Serviços e licenças avulsas entram em **"Adicionar serviço"**.
5. Em **Condições**, ajuste validade, pagamento, prazo, garantia e observações.
6. **Baixe o PDF** (para o cliente) e/ou **XLSX** (editável). Eles nunca mostram custo ou margem.
7. Depois de enviar ao cliente, clique em **Marcar como enviado**. Quando houver resposta: **aprovado** ou **recusado** (com motivo).

## Alertas e travas

| Alerta | O que significa | O que fazer |
|---|---|---|
| Custo vencido | O custo gravado no item passou da validade | Clique em **Atualizar preço** na linha (depois de atualizar o custo no produto) |
| Abaixo da margem mínima | Desconto alto demais | Reduza o desconto ou peça a um administrador para liberar com justificativa |
| Sem preço | Produto sem custo válido | Atualize o custo no produto |
| "O custo mudou no catálogo" | O catálogo tem custo diferente do item | Use **Atualizar preço** se quiser o valor novo |

O orçamento **congela** custo, margem e preço no momento em que o item é adicionado. Mudanças posteriores no catálogo não alteram orçamentos existentes.

## Regras e configurações (administrador)

- **Regras de margem:** por fabricante (vale primeiro) ou categoria; sem regra vale a margem padrão. A margem é calculada sobre o preço de venda.
- **Impostos embutidos:** percentual sobre o preço de venda (preço final = custo ÷ (1 − margem − impostos)).
- **Usuários:** o vendedor, por padrão, **não vê custo nem margem**. Libere em Usuários → "Mostrar custos".

## Logotipo

Coloque o arquivo do logotipo em `assets/logo.png` (ou `logo.jpg`). Ele aparece no cabeçalho do PDF. Sem o arquivo, o PDF usa o nome da empresa em texto.
