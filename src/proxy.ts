import { NextResponse, type NextRequest } from "next/server";

// Verificação otimista: a autorização real acontece nas páginas e ações (requireUser/requireCan).
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (request.method !== "GET" && request.method !== "HEAD") {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (origin) {
      let originHost = "";
      try {
        originHost = new URL(origin).host;
      } catch {
        /* origem inválida */
      }
      if (originHost !== host) return new NextResponse("Origem não permitida", { status: 403 });
    }
  }

  // /api/precos e /api/cron têm autenticação própria (chave do fornecedor / segredo do agendador), sem cookie de sessão.
  // /p/ é o link do cliente (o código secreto do orçamento é a credencial).
  const isClientLink = pathname.startsWith("/p/");
  const isPublic = isClientLink || pathname === "/login" || pathname.startsWith("/login/") || pathname.startsWith("/api/precos/") || pathname === "/api/cron/precos";
  const hasSession = request.cookies.has("sid");
  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && hasSession && request.method === "GET") {
    return NextResponse.redirect(new URL("/orcamentos", request.url));
  }
  if (isClientLink) {
    // A página do cliente é sempre clara (e imprimível), seja qual for o tema salvo no navegador.
    const forwarded = new Headers(request.headers);
    forwarded.set("x-light-theme", "1");
    return NextResponse.next({ request: { headers: forwarded } });
  }
  return NextResponse.next();
}

export const config = {
  // /brand/ guarda o logo (público: a tela de login precisa dele antes da autenticação).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
