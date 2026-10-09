CREATE TABLE `importacoes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`nome_arquivo` text NOT NULL,
	`cabecalhos_json` text NOT NULL,
	`linhas_json` text NOT NULL,
	`mapeamento_json` text,
	`padroes_json` text DEFAULT '{}' NOT NULL,
	`resumo_json` text,
	`aplicada_em` integer,
	`expira_em` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `modelos_importacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fornecedor_id` integer NOT NULL,
	`mapeamento_json` text NOT NULL,
	`padroes_json` text DEFAULT '{}' NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`fornecedor_id`) REFERENCES `fornecedores`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `modelos_importacao_fornecedor_id_unique` ON `modelos_importacao` (`fornecedor_id`);