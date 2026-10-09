/** Fundo da área de acesso: brilhos nas cores da marca + grade sutil. Sempre escuro. */
export function AuthBackground() {
  return (
    <div className="login-bg" aria-hidden>
      <span className="login-orb purple" />
      <span className="login-orb cyan" />
      <span className="login-orb green" />
      <div className="login-grid" />
    </div>
  );
}
