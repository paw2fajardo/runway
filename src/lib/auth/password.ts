import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";

function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, KEY_BYTES, {
      N: SCRYPT_COST,
      r: SCRYPT_BLOCK_SIZE,
      p: SCRYPT_PARALLELIZATION,
    }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}
const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 1_024;

function isValidPassword(password: string): boolean {
  return (
    typeof password === "string" &&
    password.length >= MIN_PASSWORD_LENGTH &&
    password.length <= MAX_PASSWORD_LENGTH
  );
}

export async function hashPassword(password: string): Promise<string> {
  if (!isValidPassword(password)) {
    throw new Error(`Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`);
  }

  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(password, salt);

  return ["scrypt", SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION, salt.toString("hex"), key.toString("hex")].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (!isValidPassword(password) || typeof encodedHash !== "string") return false;

  const parts = encodedHash.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [nText, rText, pText, saltHex, keyHex] = parts.slice(1);
  const n = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (
    n !== SCRYPT_COST || r !== SCRYPT_BLOCK_SIZE || p !== SCRYPT_PARALLELIZATION ||
    !/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(keyHex)
  ) return false;

  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(keyHex, "hex");
  const actual = await deriveKey(password, salt);
  return timingSafeEqual(actual, expected);
}
