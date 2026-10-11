CREATE TABLE `alteracoes_pendentes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`execucao_id` integer NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`produto_id` integer NOT NULL,
	`sku_fornecedor` text,
	`url_produto` text,
	`custo_anterior_centavos` integer NOT NULL,
	`custo_novo_centavos` integer NOT NULL,
	`validade_dias` integer,
	`estado` text DEFAULT 'pendente' NOT NULL,
	`resolvida_por` integer,
	`resolvida_em` integer,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`execucao_id`) REFERENCES `execucoes_preco`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`produto_id`) REFERENCES `produtos`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolvida_por`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `pendentes_estado_idx` ON `alteracoes_pendentes` (`estado`,`fornecedor_id`);--> statement-breakpoint
CREATE TABLE `execucoes_preco` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`origem` text NOT NULL,
	`status` text NOT NULL,
	`nome_arquivo` text,
	`mensagem` text,
	`resumo_json` text,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `execucoes_forn_idx` ON `execucoes_preco` (`fornecedor_id`,`criado_em`);--> statement-breakpoint
CREATE TABLE `fontes_preco` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`url_arquivo` text,
	`cabecalho_auth` text,
	`token_hash` text,
	`token_final` text,
	`limite_variacao_bps` integer DEFAULT 3000 NOT NULL,
	`ativo` integer DEFAULT true NOT NULL,
	`ultima_execucao_em` integer,
	`ultimo_sucesso_em` integer,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `fontes_preco_fornecedor_id_unique` ON `fontes_preco` (`fornecedor_id`);