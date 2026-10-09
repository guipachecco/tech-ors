import type { z } from "zod";

export class ValidationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) {
    super(Object.values(fields)[0] ?? "Dados inválidos");
    this.name = "ValidationError";
    this.fields = fields;
  }
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} não encontrado(a)`);
    this.name = "NotFoundError";
  }
}

export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  const fields: Record<string, string> = {};
  for (const issue of r.error.issues) {
    const key = issue.path.join(".") || "_";
    if (!(key in fields)) fields[key] = issue.message;
  }
  throw new ValidationError(fields);
}
