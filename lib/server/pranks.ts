import { waitUntil } from "cloudflare:workers";
import { chatMemberSession } from "./event";
import { readEvent, readEventForChat, type StoredEvent, type StoredParticipant } from "./git-store";
import { ApiError } from "./http";
import {
  claimPranks, cleanPranks, createOffer, currentOffer, dispatchOffer, dispatchOrganizer, findDispatch, findOffer,
  markPresence, onlinePresence, prankDatabase, publicDispatch, type PrankKind, type PrankOffer, type PrankTarget, type Presence,
} from "./prank-store";

const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function uuid(input: unknown, error: string) {
  if (typeof input !== "string" || !uuidPattern.test(input)) throw new ApiError(400, error);
  return input.toLowerCase();
}

function presenceSequence(input: unknown) {
  if (typeof input !== "number" || !Number.isSafeInteger(input) || input < 1) {
    throw new ApiError(400, "A atualização de presença é inválida.");
  }
  return input;
}

function targetLabel(person: StoredParticipant): PrankTarget {
  return { id: person.id, name: person.name, nickname: person.nickname };
}

function liveMember(person: StoredParticipant | undefined, sessionKey: string, now: number) {
  if (!person?.access) return undefined;
  const accessIv = person.access.iv;
  return person.browserSessions?.some((session) =>
    session.fingerprint === sessionKey && session.accessIv === accessIv && session.expiresAt > now)
    ? person : undefined;
}

async function currentTargets(db: D1Database, event: StoredEvent, now: number, except?: string) {
  const members = new Map(event.participants.map((person) => [person.id, person]));
  const targets = new Map<string, Presence & PrankTarget>();
  for (const row of await onlinePresence(db, now)) {
    if (row.participantId === except || targets.has(row.participantId)) continue;
    const person = liveMember(members.get(row.participantId), row.sessionKey, now);
    if (person) targets.set(row.participantId, { ...row, ...targetLabel(person) });
  }
  return [...targets.values()];
}

function randomIndex(size: number) {
  const sample = new Uint32Array(1);
  const cutoff = Math.floor(2 ** 32 / size) * size;
  do {
    crypto.getRandomValues(sample);
  } while (sample[0] >= cutoff);
  return sample[0] % size;
}

function targetForOffer(offer: PrankOffer, event: StoredEvent, now: number) {
  const person = liveMember(event.participants.find(({ id }) => id === offer.targetParticipantId), offer.targetSessionKey, now);
  if (!person) return undefined;
  return {
    ...targetLabel(person), participantId: offer.targetParticipantId, sessionKey: offer.targetSessionKey,
    tabId: offer.targetTabId, epoch: offer.targetEpoch,
  };
}

async function offerFor(db: D1Database, source: Presence, event: StoredEvent, now: number) {
  let offer = await currentOffer(db, source, now);
  if (!offer && randomIndex(5) === 0) {
    const targets = await currentTargets(db, event, now, source.participantId);
    if (targets.length) {
      const target = targets[randomIndex(targets.length)];
      const kind = randomIndex(100) < 8 ? "scare" : "tomato";
      offer = await createOffer(db, source, target, kind, now);
    }
  }

  if (!offer) return undefined;
  const target = targetForOffer(offer, event, now);
  if (!target) return undefined;
  return { id: offer.id, kind: offer.kind, expiresAt: offer.expiresAt, target: { id: target.id, name: target.name, nickname: target.nickname } };
}

export async function heartbeat(input: Record<string, unknown>) {
  const tabId = uuid(input.tabId, "A aba do participante é inválida.");
  const sequence = presenceSequence(input.sequence);
  const { viewer, event, sessionFingerprint } = await chatMemberSession(input.sessionToken);
  const db = prankDatabase();
  const now = Date.now();
  const source = await markPresence(db, { tabId, participantId: viewer.id, sessionKey: sessionFingerprint }, sequence, true, now);
  if (!source) return { events: [] };

  const offer = await offerFor(db, source, event, now).catch(() => undefined);
  const events = await claimPranks(db, source, now);
  if (randomIndex(20) === 0) waitUntil(cleanPranks(db, now).catch(() => undefined));
  return { events, offer };
}

export async function leavePresence(input: Record<string, unknown>) {
  const tabId = uuid(input.tabId, "A aba do participante é inválida.");
  const sequence = presenceSequence(input.sequence);
  const { viewer, sessionFingerprint } = await chatMemberSession(input.sessionToken);
  const db = prankDatabase();
  await markPresence(db, { tabId, participantId: viewer.id, sessionKey: sessionFingerprint }, sequence, false, Date.now());
  return { ok: true };
}

export async function sendMemberPrank(input: Record<string, unknown>) {
  const tabId = uuid(input.tabId, "A aba do participante é inválida.");
  const offerId = uuid(input.offerId, "O convite da brincadeira é inválido.");
  const { viewer, event, sessionFingerprint } = await chatMemberSession(input.sessionToken, true);
  const db = prankDatabase();
  const source = { tabId, participantId: viewer.id, sessionKey: sessionFingerprint };
  const offer = await findOffer(db, offerId, source);
  if (!offer) throw new ApiError(409, "Este convite já expirou.");
  const prior = await findDispatch(db, `member:${offerId}`);
  if (prior) return publicDispatch(prior);

  const now = Date.now();
  const target = targetForOffer(offer, event, now);
  if (!target || target.id === viewer.id || offer.expiresAt <= now) throw new ApiError(409, "Este convite já expirou.");
  const saved = await dispatchOffer(db, offer, target, viewer.name, now);
  if (!saved) throw new ApiError(409, "A pessoa ficou indisponível ou acabou de receber outra brincadeira.");
  return publicDispatch(saved);
}

export async function organizerPrankPresence() {
  const db = prankDatabase();
  const event = await readEventForChat();
  const targets = await currentTargets(db, event, Date.now());
  return { online: targets.map(({ id, name, nickname }) => ({ id, name, nickname })) };
}

function prankKind(input: unknown): PrankKind {
  if (input === "tomato" || input === "scare") return input;
  throw new ApiError(400, "Escolha tomate ou susto.");
}

export async function sendOrganizerPrank(input: Record<string, unknown>) {
  const requestId = uuid(input.requestId, "O identificador do envio é inválido.");
  const kind = prankKind(input.kind);
  const participantId = input.participantId === undefined ? undefined : uuid(input.participantId, "O participante é inválido.");
  const id = `organizer:${requestId}`;
  const db = prankDatabase();
  const previous = await findDispatch(db, id);
  if (previous) {
    if (previous.kind !== kind || (participantId && previous.targetId !== participantId)) {
      throw new ApiError(409, "Este envio já foi usado. Inicie outro para mudar a brincadeira.");
    }
    return publicDispatch(previous);
  }

  const event = await readEvent();
  const now = Date.now();
  const online = await currentTargets(db, event, now);
  const target = participantId ? online.find(({ id }) => id === participantId) : online.length ? online[randomIndex(online.length)] : undefined;
  if (!target) throw new ApiError(409, "Não há participante online para este envio.");
  const saved = await dispatchOrganizer(db, id, kind, target, now);
  if (!saved) throw new ApiError(409, "O participante ficou indisponível ou recebeu uma brincadeira há poucos segundos.");
  if (saved.kind !== kind || (participantId && saved.targetId !== participantId)) {
    throw new ApiError(409, "Este envio já foi usado. Inicie outro para mudar a brincadeira.");
  }
  return publicDispatch(saved);
}
