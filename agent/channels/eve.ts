import { localDev, withAuthChallenges, type AuthFn } from "eve/channels/auth";
import { eveChannel } from "eve/channels/eve";
import { sessionFromCookieHeader } from "../../lib/student-session";

/** Accept the arena's own encrypted student cookie. Same-origin requests carry it automatically. */
function studentCookie(): AuthFn<Request> {
  return withAuthChallenges(async (request) => {
    const session = sessionFromCookieHeader(request.headers.get("cookie"));
    if (!session) return null;
    return {
      authenticator: "student-harness",
      issuer: "softmax",
      principalId: session.subjectId,
      principalType: "user",
      subject: session.subjectId,
      attributes: { email: session.email },
    };
  }, [{ scheme: "Bearer" }]);
}

export default eveChannel({
  auth: [studentCookie(), localDev()],
});
