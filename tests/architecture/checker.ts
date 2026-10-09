import path from "node:path";

/**
 * Regras de arquitetura (veja docs/arquitetura.md). As dependências só descem:
 *   app → ui, modules, infra, domain      modules → infra, domain      infra → domain      ui → domain
 */
export const LAYER_RULES: Record<string, string[]> = {
  domain: [],
  infra: ["domain"],
  modules: ["infra", "domain"],
  ui: ["domain"],
  app: ["ui", "modules", "infra", "domain"],
};

/** Quem cada módulo pode usar (e só isso). Mantém o grafo sem ciclos e sem acoplamento novo por acaso. */
export const MODULE_RULES: Record<string, string[]> = {
  auth: [],
  clients: ["auth"],
  users: ["auth"],
  catalog: ["auth"],
  quotes: ["auth", "catalog"],
  exports: ["quotes"],
};

/** Pacotes proibidos em camadas que devem ser independentes de framework. */
const FORBIDDEN_PACKAGES: Record<string, RegExp> = {
  domain: /^(next(\/|$)|react(-dom)?(\/|$))/,
  infra: /^(next(\/|$)|react(-dom)?(\/|$))/,
  modules: /^(next(\/|$)|react-dom(\/|$))/, // exports usa JSX só para gerar PDF
};

const SPEC = /(?:^|[\s;])(?:import|export)\s[^"']*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm;

export const layerOf = (file: string): string => (file === "src/proxy.ts" ? "app" : file.split("/")[1]);
export const moduleOf = (file: string): string | null => /^src\/modules\/([^/]+)/.exec(file)?.[1] ?? null;

export function resolveInternal(from: string, spec: string): string | null {
  if (spec.startsWith("@/")) return "src/" + spec.slice(2);
  if (spec.startsWith(".")) return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  return null;
}

export function checkImports(sources: Record<string, string>): string[] {
  const violations: string[] = [];
  for (const [file, text] of Object.entries(sources)) {
    const layer = layerOf(file);
    if (!(layer in LAYER_RULES)) {
      violations.push(`${file}: camada desconhecida "${layer}" (use domain, infra, modules, ui ou app)`);
      continue;
    }
    for (const m of text.matchAll(SPEC)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const target = resolveInternal(file, spec);
      if (target === null) {
        const rule = FORBIDDEN_PACKAGES[layer];
        if (rule && rule.test(spec)) violations.push(`${file}: a camada "${layer}" não pode importar "${spec}"`);
        continue;
      }
      if (!target.startsWith("src/")) continue;
      const targetLayer = layerOf(target);
      if (targetLayer !== layer) {
        if (!(targetLayer in LAYER_RULES)) violations.push(`${file}: importa de camada desconhecida "${targetLayer}" (${spec})`);
        else if (!LAYER_RULES[layer].includes(targetLayer)) violations.push(`${file}: "${layer}" não pode depender de "${targetLayer}" (${spec})`);
        continue;
      }
      if (layer === "modules") {
        const a = moduleOf(file);
        const b = moduleOf(target);
        if (a && b && a !== b && !MODULE_RULES[a]?.includes(b)) violations.push(`${file}: o módulo "${a}" não pode depender do módulo "${b}" (${spec})`);
      }
    }
  }
  return violations;
}
