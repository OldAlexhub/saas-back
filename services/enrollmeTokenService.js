import crypto from "crypto";

export function generateOnboardingToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashOnboardingToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

export function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + Number(days || 0));
  return copy;
}
