import { env } from "cloudflare:workers";
import { OFFLINE_CODE_LENGTH, deriveOfflineLookup, offlineParticipantIdentity, openOfflineRecipient, type SealedAssignment } from "../offline-crypto";
import { steamGameCover, type SteamGame } from "../steam-games";
import { hasGitStorage, isSealedAssignment, readEvent, updateEvent, type DrawStatus, type StoredEvent, type StoredParticipant } from "./git-store";
import { ApiError } from "./http";
import { completeProfile, parseName, parseNickname, parsePhoto, updateProfile, type ProfileFields } from "./profile";
import { ACCESS_CODE_LENGTH, deriveAccessLookup, openVaultCode, sealVaultCode } from "./vault";

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
const demoParticipant: StoredParticipant = { id: "demo", ...demoProfiles[1], unavailableDays: null };
const demoGames: SteamGame[] = [
  { id: 730, name: "Counter-Strike 2", cover: steamGameCover(730) },
  { id: 570, name: "Dota 2", cover: steamGameCover(570) },
  { id: 440, name: "Team Fortress 2", cover: steamGameCover(440) },
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

function directoryEntry({ id, name, nickname, steamCode }: StoredParticipant) {
  return { id, name, nickname, steamCode };
}

async function eventForParticipants(): Promise<StoredEvent | null> {
  return hasGitStorage() ? readEvent() : null;
}

function statusOf(event: StoredEvent | null): DrawStatus {
  return event?.drawStatus ?? (event?.drawn ? "definitive" : "draft");
}

function roundFields(event: StoredEvent | null) {
  return { drawStatus: statusOf(event), drawId: event?.drawn ? event.drawId ?? "legacy" : undefined };
}

function requireActiveDraw(event: StoredEvent | null): asserts event is StoredEvent {
  if (statusOf(event) === "cancelled") throw new ApiError(409, "O sorteio foi cancelado pela organização.");
  if (!event?.drawn) throw new ApiError(409, "O sorteio ainda não foi ativado pela organização.");
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

function invalidAccess() {
  return new ApiError(401, "Código de acesso inválido.");
}

function accessCode(input: unknown) {
  const code = typeof input === "string" ? input.trim() : "";
  if (code !== demoCode && !isAccountCode(code)) throw invalidAccess();
  return code;
}

function isAccountCode(code: string) {
  return code.length === ACCESS_CODE_LENGTH && /^\d+$/.test(code);
}

function isDemoAccess(event: StoredEvent | null, code: string) {
  return statusOf(event) === "draft" && code === demoCode;
}

function authorizedParticipant(event: StoredEvent | null, lookup: string) {
  const participant = event?.participants.find((person) => person.access?.lookup === lookup);
  if (!participant) throw invalidAccess();
  return participant;
}

function participantSession(person: StoredParticipant, mode: Mode, event: StoredEvent | null) {
  return {
    participant: { ...publicProfile(person), id: person.id, steamCode: person.steamCode, games: person.games ?? [] },
    mode,
    ...roundFields(event),
    profileComplete: completeProfile(person),
    revealed: !!event?.drawn && !!person.revealedAt,
  };
}

function replaceParticipant(event: StoredEvent, participant: StoredParticipant) {
  return { ...event, participants: event.participants.map((person) => person.id === participant.id ? participant : person) };
}

function requireCompleteProfile(person: StoredParticipant) {
  if (!completeProfile(person)) {
    throw new ApiError(409, "Adicione uma foto, informe o código de amigo da Steam e escolha três jogos diferentes.");
  }
}

async function recipientId(person: StoredParticipant, code: string) {
  return person.sealed ? openOfflineRecipient(code, person.id, person.sealed).catch(() => undefined) : person.recipientId;
}

async function matchingRecipient(event: StoredEvent, person: StoredParticipant, code: string) {
  if (!event.drawn) return undefined;
  if (person.sealed) {
    if (code.length !== OFFLINE_CODE_LENGTH || await deriveOfflineLookup(code) !== person.sealed.lookup) return undefined;
  } else if (code.length !== legacyCodeLength || person.code !== code) {
    return undefined;
  }
  const id = await recipientId(person, code);
  return event.participants.find((candidate) => candidate.id === id && candidate.id !== person.id);
}

export async function publicEvent() {
  const event = await eventForParticipants();
  const round = roundFields(event);
  return { mode: round.drawStatus === "draft" ? "demo" : "live", ...round };
}

export async function loginParticipant(input: unknown) {
  const code = accessCode(input);
  const event = await eventForParticipants();
  if (isDemoAccess(event, code)) return participantSession(demoParticipant, "demo", event);

  const lookup = await deriveAccessLookup(code);
  const person = authorizedParticipant(event, lookup);
  if (person.accessedAt) return participantSession(person, "live", event);

  const accessedAt = new Date().toISOString();
  const updated = await updateEvent((current) => {
    const member = authorizedParticipant(current, lookup);
    return member.accessedAt ? current : replaceParticipant(current, { ...member, accessedAt });
  });
  return participantSession(authorizedParticipant(updated, lookup), "live", updated);
}

export async function saveParticipantProfile(input: unknown, fields: ProfileFields) {
  const code = accessCode(input);
  if (code === demoCode) {
    const event = await eventForParticipants();
    if (!isDemoAccess(event, code)) throw invalidAccess();
    const updated = updateProfile(demoParticipant, fields);
    requireCompleteProfile(updated);
    return participantSession(updated, "demo", event);
  }

  const lookup = await deriveAccessLookup(code);
  const updated = await updateEvent((current) => {
    const person = updateProfile(authorizedParticipant(current, lookup), fields);
    requireCompleteProfile(person);
    return replaceParticipant(current, person);
  });
  return participantSession(authorizedParticipant(updated, lookup), "live", updated);
}

function incorrectReveal(mode: Mode, event: StoredEvent | null) {
  return {
    person: { ...memeProfiles[randomIndex(memeProfiles.length)], games: [] },
    candidates: [],
    steamFriends: [],
    canSave: false,
    days: [],
    mode,
    ...roundFields(event),
  };
}

export async function reveal(accessInput: unknown, input: unknown) {
  const access = accessCode(accessInput);
  const code = numericCode(input);
  const event = await eventForParticipants();
  if (isDemoAccess(event, access)) {
    if (code !== demoCode) return incorrectReveal("demo", event);
    return {
      person: { ...demoProfiles[0], games: demoGames },
      candidates: demoProfiles,
      steamFriends: demoProfiles.filter((_, index) => index !== 1).map(({ name, nickname }, index) => ({ id: `demo-${index}`, name, nickname })),
      canSave: true,
      days: [],
      mode: "demo" as const,
      ...roundFields(event),
    };
  }

  const voter = authorizedParticipant(event, await deriveAccessLookup(access));
  requireActiveDraw(event);
  requireCompleteProfile(voter);
  const recipient = await matchingRecipient(event, voter, code);
  if (!recipient) return incorrectReveal("live", event);
  return {
    person: { ...publicProfile(recipient), games: recipient.games ?? [] },
    candidates: event.participants.map(publicProfile),
    steamFriends: event.participants.filter((person) => person.id !== voter.id).map(directoryEntry),
    canSave: true,
    days: voter.unavailableDays ?? [],
    mode: "live" as const,
    ...roundFields(event),
  };
}

async function updateAfterReveal(
  accessInput: unknown,
  codeInput: unknown,
  change: (person: StoredParticipant) => StoredParticipant,
) {
  const access = accessCode(accessInput);
  const code = numericCode(codeInput);
  const wrongDrawCode = () => new ApiError(403, "Use o código do sorteio vinculado à sua conta.");
  if (access === demoCode) {
    if (!isDemoAccess(await eventForParticipants(), access)) throw invalidAccess();
    if (code !== demoCode) throw wrongDrawCode();
    return { ok: true };
  }

  const lookup = await deriveAccessLookup(access);
  await updateEvent(async (current) => {
    const participant = authorizedParticipant(current, lookup);
    requireActiveDraw(current);
    requireCompleteProfile(participant);
    if (!await matchingRecipient(current, participant, code)) throw wrongDrawCode();
    return replaceParticipant(current, change(participant));
  });
  return { ok: true };
}

export function saveAvailability(accessInput: unknown, codeInput: unknown, daysInput: unknown) {
  const days = unavailableDays(daysInput);
  return updateAfterReveal(accessInput, codeInput, (person) => ({ ...person, unavailableDays: days }));
}

export function recordSeen(accessInput: unknown, codeInput: unknown) {
  const revealedAt = new Date().toISOString();
  return updateAfterReveal(accessInput, codeInput, (person) => ({ ...person, revealedAt: person.revealedAt ?? revealedAt }));
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

async function summarizeEvent(event: StoredEvent) {
  const drawStatus = statusOf(event);
  const phase = drawStatus === "draft" ? "draft" : "drawn";
  const offline = event.participants.some((person) => person.sealed !== undefined);
  const drawMethod = phase === "drawn" ? (offline ? "offline" : "online") : undefined;
  const unavailableCounts = new Map<string, number>();
  let responseCount = 0;

  const participants = await Promise.all(event.participants.map(async (person) => {
    const { id, code, access, drawCode, accessedAt, revealedAt, steamCode, games, unavailableDays } = person;
    if (unavailableDays !== null) {
      responseCount += 1;
      for (const day of unavailableDays) {
        unavailableCounts.set(day, (unavailableCounts.get(day) ?? 0) + 1);
      }
    }

    return {
      ...publicProfile(person),
      id,
      accessCode: access ? await openVaultCode("access", id, access) : undefined,
      code: event.drawn ? (drawCode ? await openVaultCode("draw", id, drawCode) : code) : undefined,
      accessedAt,
      revealedAt,
      steamCode,
      games: games ?? [],
      responded: unavailableDays !== null,
    };
  }));

  return {
    phase,
    drawStatus,
    drawMethod,
    participants,
    responseCount,
    dates: dates.map((date) => {
      const unavailable = unavailableCounts.get(date) ?? 0;
      return { date, available: responseCount - unavailable, unavailable };
    }),
  };
}

function requireDraft(event: StoredEvent) {
  const status = statusOf(event);
  if (status === "cancelled") throw new ApiError(409, "Volte o sorteio cancelado para rascunho para alterar a lista ou importar outro resultado.");
  if (status !== "draft") throw new ApiError(409, "O sorteio já aconteceu e a lista foi encerrada.");
}

function requireUniqueIdentities(participants: readonly Pick<StoredParticipant, "name" | "nickname">[]) {
  const identities = new Set(participants.map(({ name, nickname }) => offlineParticipantIdentity(name, nickname)));
  if (identities.size !== participants.length) {
    throw new ApiError(400, "Há participantes com o mesmo nome e apelido. Use apelidos diferentes para distinguir essas pessoas.");
  }
}

function validateRoster(input: unknown) {
  if (!Array.isArray(input) || input.length > 32) {
    throw new ApiError(400, "Cadastre no máximo 32 participantes.");
  }

  const ids = new Set<string>();
  const roster = input.map((entry: unknown) => {
    const profile = entry as (ProfileFields & { id?: unknown; name?: unknown; nickname?: unknown }) | null;
    const id = profile?.id;
    if (id !== undefined) {
      if (typeof id !== "string" || !participantIdPattern.test(id) || ids.has(id)) {
        throw new ApiError(400, "A lista contém um identificador de participante inválido ou repetido.");
      }
      ids.add(id);
    }
    const name = parseName(profile?.name);
    const nickname = parseNickname(profile?.nickname, name);
    const photo = parsePhoto(profile?.photo, name);
    return { id, name, nickname, photo, steamCode: profile?.steamCode, games: profile?.games };
  });
  requireUniqueIdentities(roster);
  return roster;
}

export async function updateRoster(action: unknown, input: unknown) {
  if (action === "draw") throw new ApiError(400, "Faça o sorteio no gerador offline e importe o arquivo criptografado.");
  if (action !== "save") throw new ApiError(400, "Ação inválida.");

  const roster = validateRoster(input);
  const event = await updateEvent((current) => {
    requireDraft(current);
    const saved = new Map(current.participants.map((person) => [person.id, person]));
    const participants = roster.map(({ id, name, nickname, photo, steamCode, games }) => {
      const previous = id === undefined ? undefined : saved.get(id);
      if (id !== undefined && !previous) throw new ApiError(409, "A lista mudou. Atualize o painel antes de salvar.");
      const base = previous ?? { id: crypto.randomUUID(), name, photo, unavailableDays: null };
      const profile = { ...base, name, nickname, photo };
      return updateProfile(profile, { steamCode, games });
    });
    return { version: 1, drawn: false, participants };
  });
  return summarizeEvent(event);
}

export async function generateAccessCodes() {
  const event = await updateEvent(async (current) => {
    if (!current.participants.length) throw new ApiError(400, "Cadastre participantes antes de gerar códigos de acesso.");

    const used = new Set(current.participants.flatMap((person) => person.access ? [person.access.lookup] : []));
    const participants: StoredParticipant[] = [];
    for (const person of current.participants) {
      if (person.access) {
        participants.push(person);
        continue;
      }

      let code: string;
      let lookup: string;
      do {
        code = Array.from({ length: ACCESS_CODE_LENGTH }, () => randomIndex(10)).join("");
        lookup = await deriveAccessLookup(code);
      } while (used.has(lookup));
      used.add(lookup);
      participants.push({ ...person, access: { lookup, ...await sealVaultCode("access", person.id, code) } });
    }
    return { ...current, participants };
  });
  return summarizeEvent(event);
}

function editedStatus(input: unknown, previous: string | undefined, now: string) {
  if (input === undefined) return previous;
  if (typeof input !== "boolean") throw new ApiError(400, "Informe um estado válido para o participante.");
  return input ? previous ?? now : undefined;
}

async function editedAccess(event: StoredEvent, participant: StoredParticipant, input: unknown) {
  if (input === undefined) return participant.access;
  const code = typeof input === "string" ? input.trim() : null;
  if (code === "") return undefined;
  if (!code || !isAccountCode(code)) throw new ApiError(400, `Use ${ACCESS_CODE_LENGTH} dígitos no código de acesso.`);

  const lookup = await deriveAccessLookup(code);
  if (participant.access?.lookup === lookup) return participant.access;
  if (event.participants.some((person) => person.access?.lookup === lookup)) {
    throw new ApiError(409, "Esse código de acesso já pertence a outra pessoa.");
  }
  return { lookup, ...await sealVaultCode("access", participant.id, code) };
}

export async function editParticipant(input: Record<string, unknown>) {
  if (typeof input.participantId !== "string" || !participantIdPattern.test(input.participantId)) {
    throw new ApiError(400, "Selecione um participante válido.");
  }
  const now = new Date().toISOString();
  const event = await updateEvent(async (current) => {
    const participant = current.participants.find((person) => person.id === input.participantId);
    if (!participant) throw new ApiError(404, "Participante não encontrado.");
    const name = input.name === undefined ? participant.name : parseName(input.name);
    const nickname = input.nickname === undefined ? participant.nickname : parseNickname(input.nickname, name);
    const identity = offlineParticipantIdentity(name, nickname);
    if (identity !== offlineParticipantIdentity(participant.name, participant.nickname) &&
      current.participants.some((person) => person.id !== participant.id && offlineParticipantIdentity(person.name, person.nickname) === identity)) {
      throw new ApiError(400, "Já existe um participante com esse nome e apelido.");
    }
    const profile = updateProfile({ ...participant, name, nickname }, input);
    return replaceParticipant(current, {
      ...profile,
      accessedAt: editedStatus(input.accessed, participant.accessedAt, now),
      revealedAt: editedStatus(input.revealed, participant.revealedAt, now),
      access: await editedAccess(current, participant, input.accessCode),
    });
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

async function offlineCodes(input: unknown) {
  if (!Array.isArray(input) || input.length < 2 || input.length > 32 ||
    !input.every((code) => typeof code === "string" && code.length === OFFLINE_CODE_LENGTH && /^\d+$/.test(code))) {
    throw new ApiError(400, "Use os códigos de sorteio do arquivo TXT da distribuição offline.");
  }
  const codes = new Set<string>(input);
  if (codes.size !== input.length) throw new ApiError(400, "O arquivo de distribuição contém códigos repetidos.");
  const entries = await Promise.all([...codes].map(async (code) => [await deriveOfflineLookup(code), code] as const));
  return new Map(entries);
}

async function attachDrawCodes(participants: StoredParticipant[], codes: Map<string, string>) {
  const rosterIds = new Set(participants.map(({ id }) => id));
  if (codes.size !== participants.length || rosterIds.size !== participants.length) {
    throw new ApiError(400, "O arquivo TXT precisa conter um código de sorteio para cada pessoa da lista.");
  }

  const entries = await Promise.all(participants.map(async (person) => {
    const sealed = person.sealed;
    const code = sealed && codes.get(sealed.lookup);
    if (!sealed || !code) throw new ApiError(400, "Os códigos do TXT não correspondem ao sorteio criptografado.");
    const recipient = await recipientId(person, code);
    if (!recipient || recipient === person.id || !rosterIds.has(recipient)) {
      throw new ApiError(400, "O arquivo criptografado não contém um sorteio válido para esta lista.");
    }
    return { person, code, recipient };
  }));

  if (new Set(entries.map(({ recipient }) => recipient)).size !== participants.length) {
    throw new ApiError(400, "O arquivo criptografado sorteia a mesma pessoa mais de uma vez.");
  }

  return Promise.all(entries.map(async ({ person, code }) => ({
    ...person,
    code: undefined,
    recipientId: undefined,
    drawCode: person.drawCode ?? await sealVaultCode("draw", person.id, code),
  })));
}

export async function importOfflineDraw(input: unknown, drawCodes: unknown, kind: unknown = "definitive") {
  if (kind !== "test" && kind !== "definitive") throw new ApiError(400, "Escolha um sorteio de teste ou definitivo.");
  const assignments = offlineAssignments(input);
  const codes = await offlineCodes(drawCodes);
  const drawId = crypto.randomUUID();
  const rosterMismatch = "O arquivo não corresponde à lista salva. Exporte a lista atual e refaça o sorteio offline.";
  const event = await updateEvent(async (current) => {
    requireDraft(current);
    requireUniqueIdentities(current.participants);
    if (current.participants.length !== assignments.size) throw new ApiError(409, rosterMismatch);

    const participants = current.participants.map((person) => {
      const sealed = assignments.get(person.id);
      if (!sealed) throw new ApiError(409, rosterMismatch);
      return { ...person, sealed };
    });
    return { ...current, drawn: true, drawStatus: kind, drawId, participants: await attachDrawCodes(participants, codes) };
  });
  return summarizeEvent(event);
}

export async function cancelDraw() {
  const event = await updateEvent((current) => {
    if (statusOf(current) !== "definitive") throw new ApiError(409, "Somente um sorteio definitivo ativo pode ser cancelado.");
    return { ...current, drawn: false, drawStatus: "cancelled" };
  });
  return summarizeEvent(event);
}

export async function resetDraw() {
  const event = await updateEvent((current) => {
    const status = statusOf(current);
    if (status !== "test" && status !== "cancelled") {
      throw new ApiError(409, "Somente um sorteio de teste ou cancelado pode voltar para rascunho.");
    }
    const participants = current.participants.map((person) => ({
      ...person,
      sealed: undefined,
      code: undefined,
      recipientId: undefined,
      drawCode: undefined,
      revealedAt: undefined,
      unavailableDays: null,
    }));
    return { version: 1, drawn: false, participants };
  });
  return summarizeEvent(event);
}

export async function registerDrawCodes(input: unknown) {
  const codes = await offlineCodes(input);
  const event = await updateEvent(async (current) => {
    if (!current.drawn || !current.participants.every((person) => person.sealed)) {
      throw new ApiError(409, "Ative um sorteio criptografado antes de registrar seus códigos.");
    }
    return { ...current, participants: await attachDrawCodes(current.participants, codes) };
  });
  return summarizeEvent(event);
}

export async function auditPairs(confirmation: unknown) {
  if (confirmation !== "REVELAR") throw new ApiError(400, "Digite REVELAR para confirmar a abertura dos pares.");
  const event = await readEvent();
  if (!event.drawn) throw new ApiError(409, "Ainda não existe um sorteio ativo.");

  const roster = new Map(event.participants.map((person) => [person.id, person]));
  const pairs = await Promise.all(event.participants.map(async (person) => {
    if (person.sealed && !person.drawCode) {
      throw new ApiError(409, "Registre os códigos do TXT original antes de consultar os pares.");
    }
    const code = person.drawCode ? await openVaultCode("draw", person.id, person.drawCode) : person.code ?? "";
    const id = await recipientId(person, code);
    const recipient = id && roster.get(id);
    if (!recipient || recipient.id === person.id) throw new ApiError(409, "Não foi possível abrir todos os pares do sorteio.");
    return {
      giver: { id: person.id, name: person.name, nickname: person.nickname },
      recipient: { id: recipient.id, name: recipient.name, nickname: recipient.nickname },
    };
  }));
  return { pairs };
}
