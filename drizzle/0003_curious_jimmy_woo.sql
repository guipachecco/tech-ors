CREATE TABLE `produto_fotos` (
	`produto_id` integer PRIMARY KEY NOT NULL,
	`dados` blob NOT NULL,
	`atualizado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`produto_id`) REFERENCES `produtos`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `orcamento_itens` ADD `detalhes` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `produtos` ADD `foto_versao` integer;--> statement-breakpoint
-- Itens já criados guardavam "Fabricante Modelo — especificações" num campo só: separa em título e detalhes.
UPDATE `orcamento_itens` SET `detalhes` = substr(`descricao`, instr(`descricao`, ' — ') + 3), `descricao` = substr(`descricao`, 1, instr(`descricao`, ' — ') - 1) WHERE `tipo` = 'produto' AND instr(`descricao`, ' — ') > 0;
