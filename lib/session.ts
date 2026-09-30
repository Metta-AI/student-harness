import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

const cookieName = "student_session";

const sessionSchema = z.object({
  token: z.string().min(1),
  subjectId: z.string().min(1),
  email: z.email(),
  runId: z.string().optional(),
});

export type Session = z.infer<typeof sessionSchema>;

function key() {
  const value = Buffer.from(process.env.SESSION_SECRET ?? "", "hex");
  if (value.length !== 32) throw new Error("SESSION_SECRET must be 32 bytes in hex");
  return value;
}

export function seal(session: Session) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(session)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unseal(value: string): Session {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const body = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  return sessionSchema.parse(JSON.parse(body.toString("utf8")));
}

export async function currentSession(): Promise<Session | null> {
  const value = (await cookies()).get(cookieName)?.value;
  return value ? unseal(value) : null;
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
