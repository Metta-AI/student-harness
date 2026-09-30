import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const value = Buffer.from(process.env.SESSION_SECRET ?? "", "hex");
  if (value.length !== 32) throw new Error("SESSION_SECRET must be 32 bytes in hex");
  return value;
}

/** Seal a JSON value with AES-256-GCM under SESSION_SECRET. */
export function sealJson(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function unsealJson(value: string): unknown {
  const bytes = Buffer.from(value, "base64url");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  const body = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
  return JSON.parse(body.toString("utf8"));
}
