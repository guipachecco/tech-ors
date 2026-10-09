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

  const isPublic = pathname === "/login" || pathname.startsWith("/login/");
  const hasSession = request.cookies.has("sid");
  if (!isPublic && !hasSession) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/login" && hasSession && request.method === "GET") {
    return NextResponse.redirect(new URL("/orcamentos", request.url));
  }
  return NextResponse.next();
}

export const config = {
  // /brand/ guarda o logo (público: a tela de login precisa dele antes da autenticação).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|brand/).*)"],
};
