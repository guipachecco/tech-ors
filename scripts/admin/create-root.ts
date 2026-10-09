// Cria a conta Root (dono do sistema). Só pode ser feita aqui, no servidor.
import { createAccount } from "./_account";

createAccount("root").catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
