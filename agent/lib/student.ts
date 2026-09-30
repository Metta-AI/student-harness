import type { SessionAuth } from "eve/context";
import type { SessionContext } from "eve/tools";
import { studentToken } from "../../lib/db";

export type Student = { subjectId: string; email: string };

/** The signed-in student behind a session, or null for local TUI sessions without a cookie. */
export function studentFromAuth(auth: SessionAuth): Student | null {
  const principal = auth.current ?? auth.initiator;
  if (!principal || principal.authenticator !== "student-harness") return null;
  const email = principal.attributes.email;
  return { subjectId: principal.principalId, email: typeof email === "string" ? email : "" };
}

export function requireStudent(ctx: SessionContext): Student {
  const student = studentFromAuth(ctx.session.auth);
  if (!student) throw new Error("No signed-in student on this session. Ask the student to sign in to the arena web app first.");
  return student;
}

export async function requireStudentToken(ctx: SessionContext) {
  const student = requireStudent(ctx);
  return { ...student, token: await studentToken(student.subjectId) };
}
