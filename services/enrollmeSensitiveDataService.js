import crypto from "crypto";
import config from "../config/index.js";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function encryptionKey() {
  const secret =
    process.env.ENROLLME_SENSITIVE_DATA_SECRET ||
    process.env.ENROLLME_SSN_ENCRYPTION_SECRET ||
    config.enrollme?.jwt?.secret ||
    config.jwt?.secret;

  if (!secret) {
    const err = new Error("Sensitive data encryption secret is not configured.");
    err.statusCode = 500;
    throw err;
  }

  return crypto.createHash("sha256").update(String(secret)).digest();
}

export function encryptSensitiveValue(value) {
  const plaintext = String(value || "").trim();
  if (!plaintext) return undefined;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(":");
}

export function decryptSensitiveValue(encryptedValue) {
  if (!encryptedValue) return "";
  const [version, ivText, authTagText, encryptedText] = String(encryptedValue).split(":");
  if (version !== VERSION || !ivText || !authTagText || !encryptedText) {
    const err = new Error("Encrypted sensitive value is not readable.");
    err.statusCode = 500;
    throw err;
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    encryptionKey(),
    Buffer.from(ivText, "base64url")
  );
  decipher.setAuthTag(Buffer.from(authTagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
