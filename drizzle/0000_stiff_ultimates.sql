CREATE TABLE `auditoria` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer,
	`acao` text NOT NULL,
	`entidade` text NOT NULL,
	`entidade_id` integer,
	`antes` text,
	`depois` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `clientes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`razao_social` text NOT NULL,
	`cnpj` text,
	`contato` text,
	`email` text,
	`telefone` text,
	`busca` text NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `configuracao` (
	`id` integer PRIMARY KEY NOT NULL,
	`empresa_nome` text DEFAULT 'Minha Empresa' NOT NULL,
	`empresa_cnpj` text DEFAULT '' NOT NULL,
	`empresa_endereco` text DEFAULT '' NOT NULL,
	`empresa_telefone` text DEFAULT '' NOT NULL,
	`empresa_email` text DEFAULT '' NOT NULL,
	`validade_custo_dias_padrao` integer DEFAULT 7 NOT NULL,
	`validade_proposta_dias` integer DEFAULT 15 NOT NULL,
	`impostos_bps` integer DEFAULT 0 NOT NULL,
	`margem_padrao_bps` integer DEFAULT 2000 NOT NULL,
	`margem_minima_padrao_bps` integer DEFAULT 1000 NOT NULL,
	`condicoes_pagamento` text DEFAULT 'À vista ou a combinar' NOT NULL,
	`prazo_entrega` text DEFAULT 'A combinar' NOT NULL,
	`garantia` text DEFAULT 'Conforme fabricante' NOT NULL,
	`observacoes_padrao` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `fornecedores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`site` text,
	`observacoes` text,
	`ativo` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ofertas_custo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`produto_id` integer NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`sku_fornecedor` text,
	`url_produto` text,
	`custo_centavos` integer NOT NULL,
	`observacao` text,
	`obtido_em` integer NOT NULL,
	`valido_ate` integer NOT NULL,
	`criado_por` integer,
	FOREIGN KEY (`produto_id`) REFERENCES `produtos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ofertas_produto_idx` ON `ofertas_custo` (`produto_id`);--> statement-breakpoint
CREATE TABLE `orcamento_itens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`orcamento_id` integer NOT NULL,
	`tipo` text NOT NULL,
	`produto_id` integer,
	`descricao` text NOT NULL,
	`quantidade` integer NOT NULL,
	`custo_centavos` integer DEFAULT 0 NOT NULL,
	`margem_bps` integer DEFAULT 0 NOT NULL,
	`margem_minima_bps` integer DEFAULT 0 NOT NULL,
	`impostos_bps` integer DEFAULT 0 NOT NULL,
	`preco_unitario_centavos` integer NOT NULL,
	`desconto_bps` integer DEFAULT 0 NOT NULL,
	`custo_valido_ate` integer,
	`oferta_custo_id` integer,
	FOREIGN KEY (`orcamento_id`) REFERENCES `orcamentos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`produto_id`) REFERENCES `produtos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`oferta_custo_id`) REFERENCES `ofertas_custo`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `itens_orcamento_idx` ON `orcamento_itens` (`orcamento_id`);--> statement-breakpoint
CREATE TABLE `orcamentos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`numero` text NOT NULL,
	`cliente_id` integer NOT NULL,
	`status` text DEFAULT 'em_elaboracao' NOT NULL,
	`valido_ate` integer NOT NULL,
	`condicoes_pagamento` text DEFAULT '' NOT NULL,
	`prazo_entrega` text DEFAULT '' NOT NULL,
	`garantia` text DEFAULT '' NOT NULL,
	`observacoes` text DEFAULT '' NOT NULL,
	`frete_centavos` integer DEFAULT 0 NOT NULL,
	`motivo_resultado` text,
	`criado_por` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`enviado_em` integer,
	FOREIGN KEY (`cliente_id`) REFERENCES `clientes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`criado_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orcamentos_numero_idx` ON `orcamentos` (`numero`);--> statement-breakpoint
CREATE TABLE `produtos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sku` text NOT NULL,
	`fabricante` text NOT NULL,
	`modelo` text NOT NULL,
	`categoria` text NOT NULL,
	`descricao` text DEFAULT '' NOT NULL,
	`especificacoes` text,
	`busca` text NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `produtos_sku_unique` ON `produtos` (`sku`);--> statement-breakpoint
CREATE INDEX `produtos_busca_idx` ON `produtos` (`busca`);--> statement-breakpoint
CREATE TABLE `regras_margem` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`escopo` text NOT NULL,
	`chave` text NOT NULL,
	`margem_bps` integer NOT NULL,
	`margem_minima_bps` integer NOT NULL,
	`validade_custo_dias` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `regras_escopo_chave_idx` ON `regras_margem` (`escopo`,`chave`);--> statement-breakpoint
CREATE TABLE `sequencia_orcamento` (
	`ano` integer PRIMARY KEY NOT NULL,
	`ultimo` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`expira_em` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessoes_token_hash_unique` ON `sessoes` (`token_hash`);--> statement-breakpoint
CREATE TABLE `usuarios` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`nome` text NOT NULL,
	`email` text NOT NULL,
	`senha_hash` text NOT NULL,
	`perfil` text NOT NULL,
	`pode_ver_custo` integer DEFAULT false NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usuarios_email_unique` ON `usuarios` (`email`);