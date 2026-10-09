// Sobe o servidor de desenvolvimento apontando para o banco de demonstração (.env.dev).
import { spawn } from "node:child_process";

process.loadEnvFile(".env");
process.loadEnvFile(".env.dev");
spawn("npx", ["next", "dev", "-p", "3100"], { stdio: "inherit", shell: true, env: process.env });
