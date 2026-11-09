import { env } from "cloudflare:workers";
import { ApiError } from "./http";

declare global {
  namespace Cloudflare {
    interface Env {
      DRAW_VAULT_KEY?: string;
    }
  }
}

export type VaultCode = { iv: string; ciphertext: string };
export type AccessCredential = VaultCode & { lookup: string };

export const ACCESS_CODE_LENGTH = 20;

type CodeKind = "access" | "draw";

const encoder = new TextEncoder();
const context = "amigo-secreto-2026:vault:v1";

function toBase64Url(bytes: Uint8Array<ArrayBuffer>) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string) {
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (character) => character.charCodeAt(0));
}

function keyFor(usage: "encrypt" | "decrypt") {
  const hex = env.DRAW_VAULT_KEY?.trim();
  if (!hex || !/^[a-f\d]{64}$/i.test(hex)) {
    throw new ApiError(503, "A organização precisa configurar a chave do cofre de códigos da API.");
  }
  const bytes = Uint8Array.from(hex.match(/../g)!, (octet) => Number.parseInt(octet, 16));
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [usage]);
}

function parameters(iv: Uint8Array<ArrayBuffer>, kind: CodeKind, participantId: string): AesGcmParams {
  return { name: "AES-GCM", iv, additionalData: encoder.encode(`${context}:${kind}:${participantId}`) };
}

export async function deriveAccessLookup(code: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${context}:access:lookup:${code}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sealVaultCode(kind: CodeKind, participantId: string, code: string): Promise<VaultCode> {
  const key = await keyFor("encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(parameters(iv, kind, participantId), key, encoder.encode(code));
  return { iv: toBase64Url(iv), ciphertext: toBase64Url(new Uint8Array(ciphertext)) };
}

export async function openVaultCode(kind: CodeKind, participantId: string, secret: VaultCode) {
  const key = await keyFor("decrypt");
  try {
    const plaintext = await crypto.subtle.decrypt(
      parameters(fromBase64Url(secret.iv), kind, participantId),
      key,
      fromBase64Url(secret.ciphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new ApiError(503, "Não foi possível abrir os códigos do evento com a chave atual do cofre.");
  }
}
