import { randomBytes, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  createMortgageIdentityFingerprinter,
  type MortgageIdentityFingerprinter,
} from "../src/domain/import/mortgageIdentityFingerprint.js";

interface ProtectedStringStorage {
  isEncryptionAvailable: () => boolean;
  encryptString: (value: string) => Buffer;
  decryptString: (value: Buffer) => string;
}

function decodeMortgageIdentityKey(encodedKey: string): Buffer {
  const key = Buffer.from(encodedKey, "base64");
  if (key.byteLength !== 32 || key.toString("base64") !== encodedKey) {
    throw new Error("The protected mortgage identity key is invalid.");
  }
  return key;
}

export function loadOrCreateMortgageIdentityFingerprinter(
  keyPath: string,
  protectedStorage: ProtectedStringStorage
): MortgageIdentityFingerprinter {
  if (!protectedStorage.isEncryptionAvailable()) {
    throw new Error("Operating-system encryption is unavailable for the mortgage identity key.");
  }

  if (existsSync(keyPath)) {
    const encryptedKey = readFileSync(keyPath);
    return createMortgageIdentityFingerprinter(
      decodeMortgageIdentityKey(protectedStorage.decryptString(encryptedKey))
    );
  }

  mkdirSync(dirname(keyPath), { recursive: true });
  const key = randomBytes(32);
  const encryptedKey = protectedStorage.encryptString(key.toString("base64"));
  const temporaryPath = `${keyPath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, encryptedKey, { flag: "wx", mode: 0o600 });
    renameSync(temporaryPath, keyPath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return createMortgageIdentityFingerprinter(key);
}
