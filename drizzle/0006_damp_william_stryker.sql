ALTER TABLE `configuracao` ADD `exigir_aprovacao_interna` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovacao_status` text DEFAULT 'nenhuma' NOT NULL;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovacao_pedida_por` integer REFERENCES usuarios(id);--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovacao_pedida_em` integer;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovado_por` integer REFERENCES usuarios(id);--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovado_em` integer;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovacao_nota` text;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `aprovacao_mudancas_json` text;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `token_publico` text;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `respondido_por_nome` text;--> statement-breakpoint
ALTER TABLE `orcamentos` ADD `respondido_em` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `orcamentos_token_idx` ON `orcamentos` (`token_publico`);