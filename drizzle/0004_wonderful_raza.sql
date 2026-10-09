CREATE TABLE `limites_tentativa` (
	`chave` text PRIMARY KEY NOT NULL,
	`janela_inicio` integer NOT NULL,
	`contagem` integer DEFAULT 0 NOT NULL,
	`bloqueado_ate` integer DEFAULT 0 NOT NULL
);
