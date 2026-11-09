export type SealedAssignment = { lookup: string; iv: string; ciphertext: string };
export type OfflineParticipant = { id: string; name: string; nickname?: string };
export type OfflineDraw = {
  version: 1;
  assignments: (SealedAssignment & { participantId: string })[];
};

export const OFFLINE_CODE_LENGTH = 30;

const encoder = new TextEncoder();
const context = "amigo-secreto-2026:offline:v1";
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function base64Url(bytes: Uint8Array<ArrayBuffer>) {
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function readBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function digest(value: string) {
  return crypto.subtle.digest("SHA-256", encoder.encode(value));
}

export async function deriveOfflineLookup(code: string) {
  const bytes = new Uint8Array(await digest(`${context}:lookup:${code}`));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function codeKey(code: string, usage: "encrypt" | "decrypt") {
  const material = await digest(`${context}:key:${code}`);
  return crypto.subtle.importKey("raw", material, "AES-GCM", false, [usage]);
}

function parameters(iv: Uint8Array<ArrayBuffer>, participantId: string): AesGcmParams {
  return { name: "AES-GCM", iv, additionalData: encoder.encode(`${context}:giver:${participantId}`) };
}

async function sealRecipient(code: string, participantId: string, recipientId: string): Promise<SealedAssignment> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const [key, lookup] = await Promise.all([codeKey(code, "encrypt"), deriveOfflineLookup(code)]);
  const ciphertext = await crypto.subtle.encrypt(parameters(iv, participantId), key, encoder.encode(recipientId));
  return { lookup, iv: base64Url(iv), ciphertext: base64Url(new Uint8Array(ciphertext)) };
}

export async function openOfflineRecipient(code: string, participantId: string, sealed: SealedAssignment) {
  const key = await codeKey(code, "decrypt");
  const plaintext = await crypto.subtle.decrypt(
    parameters(readBase64Url(sealed.iv), participantId),
    key,
    readBase64Url(sealed.ciphertext),
  );
  return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}

function secureIndex(size: number) {
  const sample = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / size) * size;
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % size;
}

function assignRecipients(ids: string[]) {
  const recipients = [...ids];
  do {
    for (let index = recipients.length - 1; index > 0; index--) {
      const other = secureIndex(index + 1);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
  } while (recipients.some((recipient, index) => recipient === ids[index]));
  return recipients;
}

function validLabel(value: unknown): value is string {
  return typeof value === "string" && !!value.trim() && [...value].length <= 70 && !/[\x00-\x1f\x7f]/.test(value);
}

export function parseOfflineRoster(value: unknown): OfflineParticipant[] {
  const roster = value as { version?: unknown; participants?: unknown } | null;
  if (roster?.version !== 1 || !Array.isArray(roster.participants) ||
    roster.participants.length < 2 || roster.participants.length > 32) {
    throw new Error("Selecione uma lista exportada pelo painel com 2 a 32 participantes.");
  }

  const participants = roster.participants.map((entry: unknown) => {
    const person = entry as Partial<OfflineParticipant> | null;
    if (typeof person?.id !== "string" || !uuid.test(person.id) || !validLabel(person.name) ||
      (person.nickname !== undefined && !validLabel(person.nickname))) {
      throw new Error("A lista tem um participante inválido. Exporte a lista novamente pelo painel.");
    }
    return { id: person.id, name: person.name, nickname: person.nickname };
  });

  if (new Set(participants.map(({ id }) => id.toLowerCase())).size !== participants.length) {
    throw new Error("A lista tem participantes repetidos. Exporte a lista novamente pelo painel.");
  }
  return participants;
}

export async function createOfflineDraw(participants: OfflineParticipant[]) {
  const roster = parseOfflineRoster({ version: 1, participants });
  const ids = roster.map(({ id }) => id);
  const recipients = assignRecipients(ids);
  const codes = new Set<string>();
  while (codes.size < ids.length) {
    const code = Array.from({ length: OFFLINE_CODE_LENGTH }, () => secureIndex(10)).join("");
    codes.add(code);
  }
  const individualCodes = [...codes];
  const assignments = await Promise.all(ids.map(async (participantId, index) => ({
    participantId,
    ...await sealRecipient(individualCodes[index], participantId, recipients[index]),
  })));

  const draw: OfflineDraw = { version: 1, assignments };
  return {
    draw,
    distribution: roster.map(({ name, nickname }, index) => ({ name, nickname, code: individualCodes[index] })),
  };
}
