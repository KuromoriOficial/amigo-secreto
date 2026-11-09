import { env } from "cloudflare:workers";
import { OFFLINE_CODE_LENGTH, deriveOfflineLookup, openOfflineRecipient, type SealedAssignment } from "../offline-crypto";
import { hasGitStorage, isSealedAssignment, readEvent, updateEvent, type StoredEvent } from "./git-store";
import { ApiError } from "./http";

declare global {
  namespace Cloudflare {
    interface Env {
      ORGANIZER_KEY?: string;
      ORGANIZER_EMAIL?: string;
    }
  }
}

const demoCode = "482731";
const demoProfiles: Profile[] = [
  { name: "Luiza Martins", nickname: "Lu", photo: "/demo/luiza.svg" },
  { name: "Rafael Costa", nickname: "Rafa", photo: "/demo/rafael.svg" },
  { name: "Beatriz Almeida", nickname: "Bia", photo: "/demo/beatriz.svg" },
  { name: "Pedro Lima", photo: "/demo/pedro.svg" },
];
const memeProfiles: Profile[] = [
  { name: "Gato do Overwatch", photo: "/memes/gato-overwatch.png" },
  { name: "Lula e Bolsonaro", photo: "/memes/lula-e-bolsonaro.png" },
  { name: "Meu Imposto Favorito", photo: "/memes/meu-imposto-favorito.png" },
  { name: "Vira a bunda", photo: "/memes/vira-a-bunda.png" },
  { name: "Sage do Valorant", photo: "/memes/sage.png" },
];

const dates = Array.from({ length: 61 }, (_, offset) =>
  new Date(Date.UTC(2026, 10, offset + 1)).toISOString().slice(0, 10),
);
const eventDates = new Set(dates);
const legacyCodeLength = 12;
const participantIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

type Mode = "demo" | "live";
type Profile = { name: string; nickname?: string; photo: string };

function publicProfile({ name, nickname, photo }: Profile): Profile {
  return { name, nickname, photo };
}

async function eventForParticipants(): Promise<StoredEvent | null> {
  return hasGitStorage() ? readEvent() : null;
}

function randomIndex(size: number) {
  const sample = new Uint32Array(1);
  const limit = Math.floor(2 ** 32 / size) * size;
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % size;
}

function numericCode(input: unknown) {
  const code = typeof input === "string" ? input.trim() : "";
  if (!/^\d{1,32}$/.test(code)) throw new ApiError(400, "Digite um código usando apenas números.");
  return code;
}

function unavailableDays(input: unknown) {
  if (!Array.isArray(input) || input.length > dates.length || input.some((day) => !eventDates.has(day))) {
    throw new ApiError(400, "Escolha apenas datas de novembro ou dezembro de 2026.");
  }
  return [...new Set<string>(input)].sort();
}

function isLiveCode(code: string) {
  return code.length === legacyCodeLength || code.length === OFFLINE_CODE_LENGTH;
}

async function matchingAssignment(event: StoredEvent, code: string) {
  if (!event.drawn || !isLiveCode(code)) return undefined;

  const lookup = code.length === OFFLINE_CODE_LENGTH ? await deriveOfflineLookup(code) : undefined;
  const voter = event.participants.find((person) => lookup ? person.sealed?.lookup === lookup : person.code === code);
  if (!voter) return undefined;

  const recipientId = voter.sealed
    ? await openOfflineRecipient(code, voter.id, voter.sealed).catch(() => undefined)
    : voter.recipientId;
  const recipient = event.participants.find((person) => person.id === recipientId && person.id !== voter.id);
  return recipient ? { voter, recipient } : undefined;
}

export async function publicEvent() {
  const event = await eventForParticipants();
  return { mode: event?.drawn ? "live" : "demo" };
}

export async function reveal(input: unknown) {
  const code = numericCode(input);
  const event = await eventForParticipants();
  const mode: Mode = event?.drawn ? "live" : "demo";

  const assignment = event && await matchingAssignment(event, code);
  if (assignment) {
    return {
      person: publicProfile(assignment.recipient),
      candidates: event.participants.map(publicProfile),
      canSave: true,
      days: assignment.voter.unavailableDays ?? [],
      mode,
    };
  }

  const demoMatch = mode === "demo" && code === demoCode;
  return {
    person: demoMatch ? demoProfiles[0] : memeProfiles[randomIndex(memeProfiles.length)],
    candidates: demoMatch ? demoProfiles : [],
    canSave: demoMatch,
    days: [],
    mode,
  };
}

export async function saveAvailability(codeInput: unknown, daysInput: unknown) {
  const code = numericCode(codeInput);
  const days = unavailableDays(daysInput);
  if (!isLiveCode(code)) throw new ApiError(403, "Use o código do sorteio para registrar suas datas.");

  await updateEvent(async (current) => {
    const assignment = await matchingAssignment(current, code);
    if (!assignment) throw new ApiError(403, "Use o código do sorteio para registrar suas datas.");
    const participant = assignment.voter;
    if (JSON.stringify(participant.unavailableDays) === JSON.stringify(days)) return current;
    return {
      ...current,
      participants: current.participants.map((person) =>
        person.id === participant.id ? { ...person, unavailableDays: days } : person),
    };
  });

  return { ok: true };
}

export async function requireOrganizer(request: Request) {
  const key = env.ORGANIZER_KEY;
  const organizerEmail = env.ORGANIZER_EMAIL?.trim().toLowerCase();
  const authorization = request.headers.get("Authorization") ?? "";
  if (key && authorization.startsWith("Bearer ") && authorization.length <= 1024) {
    if (await matchesKey(authorization.slice(7), key)) return;
    throw new ApiError(401, "A chave de organização está incorreta.");
  }

  if (env.PAGES_URL) {
    if (!key) throw new ApiError(503, "A organização ainda precisa configurar a chave do painel.");
    throw new ApiError(401, "Informe a chave de organização.");
  }

  const userId = request.headers.get("oai-authenticated-user-id");
  const userEmail = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (userId && organizerEmail && organizerEmail === userEmail) {
    if (request.method === "POST") requireSameOriginJson(request);
    return;
  }

  if (!key && !organizerEmail) {
    throw new ApiError(503, "Configure o acesso de organização no ambiente do site para usar o painel.");
  }
  throw new ApiError(401, "Entre com a conta organizadora ou informe a chave de organização.");
}

function requireSameOriginJson(request: Request) {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site !== "same-origin" && (site || origin !== new URL(request.url).origin)) {
    throw new ApiError(403, "Abra o painel no site para alterar o sorteio.");
  }

  const contentType = request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new ApiError(415, "Envie os dados no formato JSON.");
}

async function matchesKey(provided: string, key: string) {
  const encoder = new TextEncoder();
  const [actual, expected] = await Promise.all(
    [provided, key].map((value) => crypto.subtle.digest("SHA-256", encoder.encode(value))),
  );
  const providedBytes = new Uint8Array(actual);
  const expectedBytes = new Uint8Array(expected);
  let difference = 0;
  for (let index = 0; index < providedBytes.length; index += 1) {
    difference |= providedBytes[index] ^ expectedBytes[index];
  }

  return difference === 0;
}

export async function organizerState() {
  return summarizeEvent(await readEvent());
}

function summarizeEvent(event: StoredEvent) {
  const phase = event.drawn ? "drawn" : "draft";
  const offline = event.participants.some((person) => person.sealed !== undefined);
  const drawMethod = event.drawn ? (offline ? "offline" : "online") : undefined;
  const unavailableCounts = new Map<string, number>();
  let responseCount = 0;

  const participants = event.participants.map(({ id, name, nickname, photo, code, unavailableDays }) => {
    if (unavailableDays !== null) {
      responseCount += 1;
      for (const day of unavailableDays) {
        unavailableCounts.set(day, (unavailableCounts.get(day) ?? 0) + 1);
      }
    }

    return { id, name, nickname, photo, code: drawMethod === "online" ? code : undefined, responded: unavailableDays !== null };
  });

  return {
    phase,
    drawMethod,
    participants,
    responseCount,
    dates: dates.map((date) => {
      const unavailable = unavailableCounts.get(date) ?? 0;
      return { date, available: responseCount - unavailable, unavailable };
    }),
  };
}

function validPhoto(photo: unknown): photo is string {
  if (typeof photo !== "string" || photo.length > 100_000) return false;
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photo);
  if (!match || match[2].length < 16 || match[2].length % 4 !== 0) return false;

  const signature = atob(match[2].slice(0, 16));
  switch (match[1]) {
    case "jpeg": return signature.startsWith("\xff\xd8\xff");
    case "png": return signature.startsWith("\x89PNG\r\n\x1a\n");
    case "webp": return signature.startsWith("RIFF") && signature.endsWith("WEBP");
    default: return false;
  }
}

function validateRoster(input: unknown): Profile[] {
  if (!Array.isArray(input) || input.length > 32) {
    throw new ApiError(400, "Cadastre no máximo 32 participantes.");
  }

  return input.map((entry: unknown) => {
    const profile = entry as Partial<Profile> | null;
    const name = typeof profile?.name === "string" ? profile.name.trim() : "";
    if (!name || name.length > 70 || /[\x00-\x1f\x7f]/.test(name)) {
      throw new ApiError(400, "Cada participante precisa de um nome com até 70 caracteres.");
    }
    const nickname = typeof profile?.nickname === "string" ? profile.nickname.trim() : undefined;
    if ((profile?.nickname !== undefined && nickname === undefined) ||
      (nickname && ([...nickname].length > 70 || /[\x00-\x1f\x7f]/.test(nickname)))) {
      throw new ApiError(400, `Use até 70 caracteres no apelido de ${name}.`);
    }
    if (!validPhoto(profile?.photo)) {
      throw new ApiError(400, `Adicione uma foto JPG, PNG ou WebP válida para ${name}.`);
    }
    return { name, nickname: nickname || undefined, photo: profile.photo };
  });
}

export async function updateRoster(action: unknown, input: unknown) {
  if (action === "draw") throw new ApiError(400, "Faça o sorteio no gerador offline e importe o arquivo criptografado.");
  if (action !== "save") throw new ApiError(400, "Ação inválida.");

  const roster = validateRoster(input);
  const participants = roster.map((person) => ({ ...person, id: crypto.randomUUID(), unavailableDays: null }));
  const event = await updateEvent((current) => {
    if (current.drawn) throw new ApiError(409, "O sorteio já aconteceu e a lista foi encerrada.");
    return { version: 1, drawn: false, participants };
  });
  return summarizeEvent(event);
}

function offlineAssignments(input: unknown) {
  const draw = input as { version?: unknown; assignments?: unknown } | null;
  if (draw?.version !== 1 || !Array.isArray(draw.assignments) || draw.assignments.length < 2 || draw.assignments.length > 32) {
    throw new ApiError(400, "Escolha um arquivo criptografado gerado pelo sorteador offline.");
  }

  const assignments = new Map<string, SealedAssignment>();
  const lookups = new Set<string>();
  for (const entry of draw.assignments as unknown[]) {
    const participantId = (entry as { participantId?: unknown } | null)?.participantId;
    if (typeof participantId !== "string" || !participantIdPattern.test(participantId) || !isSealedAssignment(entry)) {
      throw new ApiError(400, "O arquivo criptografado contém uma entrada inválida.");
    }
    if (assignments.has(participantId) || lookups.has(entry.lookup)) {
      throw new ApiError(400, "O arquivo criptografado contém participantes ou códigos duplicados.");
    }
    const { lookup, iv, ciphertext } = entry;
    assignments.set(participantId, { lookup, iv, ciphertext });
    lookups.add(lookup);
  }
  return assignments;
}

export async function importOfflineDraw(input: unknown) {
  const assignments = offlineAssignments(input);
  const rosterMismatch = "O arquivo não corresponde à lista salva. Exporte a lista atual e refaça o sorteio offline.";
  const event = await updateEvent((current) => {
    if (current.drawn) throw new ApiError(409, "O sorteio já aconteceu e a lista foi encerrada.");
    const rosterIds = new Set(current.participants.map(({ id }) => id));
    if (current.participants.length !== assignments.size || rosterIds.size !== assignments.size) {
      throw new ApiError(409, rosterMismatch);
    }

    const participants = current.participants.map((person) => {
      const sealed = assignments.get(person.id);
      if (!sealed) throw new ApiError(409, rosterMismatch);
      return { ...publicProfile(person), id: person.id, unavailableDays: person.unavailableDays, sealed };
    });
    return { ...current, drawn: true, participants };
  });
  return summarizeEvent(event);
}
