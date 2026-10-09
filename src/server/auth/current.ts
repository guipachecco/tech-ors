import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "../db/client";
import { assertCan, type Action } from "./permissions";
import { validateSession, type SessionUser } from "./sessions";

export const SESSION_COOKIE = "sid";

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSession(getDb(), token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireCan(action: Action): Promise<SessionUser> {
  const user = await requireUser();
  assertCan(user, action);
  return user;
}
