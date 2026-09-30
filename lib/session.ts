import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { cookieName, seal, unseal, type Session } from "./student-session";

export { cookieName, seal, unseal, sessionFromCookieHeader, type Session } from "./student-session";

export async function currentSession(): Promise<Session | null> {
  const value = (await cookies()).get(cookieName)?.value;
  if (!value) return null;
  try {
    return unseal(value);
  } catch {
    return null;
  }
}

export function setSessionCookie(data: unknown, session: Session) {
  const next = NextResponse.json(data);
  next.cookies.set(cookieName, seal(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return next;
}

export function sameOrigin(request: Request) {
  return request.headers.get("origin") === new URL(request.url).origin;
}
