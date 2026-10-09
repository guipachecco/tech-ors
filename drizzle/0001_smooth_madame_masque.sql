CREATE TABLE `codigos_recuperacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`usuario_id` integer NOT NULL,
	`codigo_hash` text NOT NULL,
	`usado_em` integer,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `codigos_usuario_hash_idx` ON `codigos_recuperacao` (`usuario_id`,`codigo_hash`);--> statement-breakpoint
CREATE TABLE `mfa_pendentes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token_hash` text NOT NULL,
	`usuario_id` integer NOT NULL,
	`segredo_pendente_cifrado` text,
	`tentativas` integer DEFAULT 0 NOT NULL,
	`expira_em` integer NOT NULL,
	`criado_em` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`usuario_id`) REFERENCES `usuarios`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mfa_pendentes_token_hash_unique` ON `mfa_pendentes` (`token_hash`);--> statement-breakpoint
ALTER TABLE `usuarios` ADD `totp_segredo_cifrado` text;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `totp_ativo` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `usuarios` ADD `totp_ultimo_passo` integer;--> statement-breakpoint
-- 2FA passa a ser obrigatório: encerra sessões abertas antes da mudança.
DELETE FROM `sessoes`;
