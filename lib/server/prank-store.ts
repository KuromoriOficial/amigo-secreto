import { env } from "cloudflare:workers";
import { ApiError } from "./http";

export type PrankKind = "tomato" | "scare";
export type Presence = { sessionKey: string; tabId: string; participantId: string; epoch: number };
export type PrankTarget = { id: string; name: string; nickname?: string };

export type PrankOffer = {
  id: string;
  kind: PrankKind;
  sourceParticipantId: string;
  sourceSessionKey: string;
  sourceTabId: string;
  sourceEpoch: number;
  targetParticipantId: string;
  targetSessionKey: string;
  targetTabId: string;
  targetEpoch: number;
  expiresAt: number;
  used: number;
};

type IncomingPrank = { id: string; kind: PrankKind; senderName: string; createdAt: number; expiresAt: number };
type Dispatch = { id: string; kind: PrankKind; targetId: string; targetName: string; targetNickname: string | null };

const presenceTtl = 55_000;
const leaveTtl = 90_000;
const minimumHeartbeatInterval = 6_000;
const maxSessionTabs = 16;
const offerTtl = 30_000;
const offerCooldown = 100_000;
const eventTtl = 25_000;
const targetCooldown = 8_000;
const organizerCooldown = 2_000;
const retryRetention = 5 * 60_000;

const presenceColumns = "session_key AS sessionKey, tab_id AS tabId, participant_id AS participantId, epoch";
const offerColumns = `
  id, kind, source_participant_id AS sourceParticipantId, source_session_key AS sourceSessionKey,
  source_tab_id AS sourceTabId, source_epoch AS sourceEpoch,
  target_participant_id AS targetParticipantId, target_session_key AS targetSessionKey,
  target_tab_id AS targetTabId, target_epoch AS targetEpoch, expires_at AS expiresAt, used
`;
const dispatchColumns = "id, kind, target_participant_id AS targetId, target_name AS targetName, target_nickname AS targetNickname";
const livePresence = `EXISTS (
  SELECT 1 FROM prank_presence
  WHERE session_key = ? AND tab_id = ? AND epoch = ? AND participant_id = ? AND visible = 1 AND expires_at > ?
)`;
const recentTargetEvent = "EXISTS (SELECT 1 FROM prank_event WHERE target_participant_id = ? AND created_at > ?)";
const insertDispatch = `INSERT INTO prank_event (
  id, kind, sender_kind, sender_name, target_participant_id, target_name, target_nickname,
  target_session_key, target_tab_id, target_epoch, created_at, expires_at
)`;

export function prankDatabase() {
  if (!env.DB) throw new ApiError(503, "As brincadeiras ainda não estão disponíveis.");
  return env.DB;
}

function presenceBinding(presence: Presence, now: number) {
  return [presence.sessionKey, presence.tabId, presence.epoch, presence.participantId, now] as const;
}

function dispatchBinding(id: string, kind: PrankKind, senderKind: "member" | "organizer", senderName: string, target: Presence & PrankTarget, now: number) {
  return [
    id, kind, senderKind, senderName, target.participantId, target.name, target.nickname ?? null,
    target.sessionKey, target.tabId, target.epoch, now, now + eventTtl,
  ] as const;
}

export async function markPresence(
  db: D1Database,
  member: Omit<Presence, "epoch">,
  sequence: number,
  visible: boolean,
  now: number,
) {
  return db.prepare(`
    INSERT INTO prank_presence (session_key, tab_id, participant_id, sequence, epoch, visible, updated_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM prank_presence WHERE session_key = ? AND tab_id = ?)
       OR (SELECT COUNT(*) FROM prank_presence WHERE session_key = ? AND expires_at > ?) < ?
    ON CONFLICT (session_key, tab_id) DO UPDATE SET
      sequence = excluded.sequence,
      epoch = CASE
        WHEN prank_presence.visible = 1 AND excluded.visible = 1 AND prank_presence.expires_at > excluded.updated_at
        THEN prank_presence.epoch ELSE excluded.epoch END,
      visible = excluded.visible,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at
    WHERE excluded.sequence > prank_presence.sequence
      AND (excluded.visible = 0 OR (prank_presence.visible = 1 AND (
        prank_presence.expires_at <= excluded.updated_at OR prank_presence.updated_at <= excluded.updated_at - ?
      )))
    RETURNING ${presenceColumns}
  `).bind(
    member.sessionKey, member.tabId, member.participantId, sequence, sequence, visible ? 1 : 0, now,
    now + (visible ? presenceTtl : leaveTtl), member.sessionKey, member.tabId, member.sessionKey, now,
    maxSessionTabs, minimumHeartbeatInterval,
  ).first<Presence>();
}

export async function onlinePresence(db: D1Database, now: number) {
  const { results } = await db.prepare(`
    SELECT ${presenceColumns} FROM prank_presence WHERE visible = 1 AND expires_at > ? ORDER BY updated_at DESC
  `).bind(now).all<Presence>();
  return results;
}

export async function claimPranks(db: D1Database, member: Presence, now: number) {
  const { results } = await db.prepare(`
    UPDATE prank_event SET claimed_at = ?
    WHERE id IN (
      SELECT id FROM prank_event
      WHERE target_session_key = ? AND target_tab_id = ? AND target_epoch = ? AND target_participant_id = ?
        AND claimed_at IS NULL AND expires_at > ?
      ORDER BY created_at LIMIT 2
    ) AND claimed_at IS NULL AND ${livePresence}
    RETURNING id, kind, sender_name AS senderName, created_at AS createdAt, expires_at AS expiresAt
  `).bind(now, ...presenceBinding(member, now), ...presenceBinding(member, now)).all<IncomingPrank>();
  return results.sort((first, second) => first.createdAt - second.createdAt);
}

export async function currentOffer(db: D1Database, source: Presence, now: number) {
  return db.prepare(`
    SELECT ${offerColumns} FROM prank_offer
    WHERE source_session_key = ? AND source_tab_id = ? AND source_epoch = ? AND source_participant_id = ?
      AND expires_at > ? AND used = 0
      AND ${livePresence}
      AND EXISTS (
        SELECT 1 FROM prank_presence AS target
        WHERE target.session_key = prank_offer.target_session_key AND target.tab_id = prank_offer.target_tab_id
          AND target.epoch = prank_offer.target_epoch AND target.participant_id = prank_offer.target_participant_id
          AND target.visible = 1 AND target.expires_at > ?
      )
    ORDER BY created_at DESC LIMIT 1
  `).bind(...presenceBinding(source, now), ...presenceBinding(source, now), now).first<PrankOffer>();
}

export async function createOffer(db: D1Database, source: Presence, target: Presence, kind: PrankKind, now: number) {
  return db.prepare(`
    INSERT INTO prank_offer (
      id, kind, source_participant_id, source_session_key, source_tab_id, source_epoch,
      target_participant_id, target_session_key, target_tab_id, target_epoch, created_at, expires_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ${livePresence} AND ${livePresence}
      AND NOT EXISTS (SELECT 1 FROM prank_offer WHERE source_participant_id = ? AND created_at > ?)
      AND NOT ${recentTargetEvent}
    RETURNING ${offerColumns}
  `).bind(
    crypto.randomUUID(), kind, source.participantId, source.sessionKey, source.tabId, source.epoch,
    target.participantId, target.sessionKey, target.tabId, target.epoch, now, now + offerTtl,
    ...presenceBinding(source, now), ...presenceBinding(target, now), source.participantId, now - offerCooldown,
    target.participantId, now - targetCooldown,
  ).first<PrankOffer>();
}

export function findOffer(db: D1Database, id: string, source: Omit<Presence, "epoch">) {
  return db.prepare(`
    SELECT ${offerColumns} FROM prank_offer
    WHERE id = ? AND source_session_key = ? AND source_tab_id = ? AND source_participant_id = ?
  `).bind(id, source.sessionKey, source.tabId, source.participantId).first<PrankOffer>();
}

function dispatchRecord(db: D1Database, id: string) {
  return db.prepare(`SELECT ${dispatchColumns} FROM prank_event WHERE id = ?`).bind(id);
}

export function findDispatch(db: D1Database, id: string) {
  return dispatchRecord(db, id).first<Dispatch>();
}

export async function dispatchOffer(db: D1Database, offer: PrankOffer, target: Presence & PrankTarget, senderName: string, now: number) {
  const id = `member:${offer.id}`;
  const source = { sessionKey: offer.sourceSessionKey, tabId: offer.sourceTabId, participantId: offer.sourceParticipantId, epoch: offer.sourceEpoch };
  const insert = db.prepare(`
    ${insertDispatch}
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ${livePresence} AND ${livePresence}
      AND EXISTS (SELECT 1 FROM prank_offer WHERE id = ? AND used = 0 AND expires_at > ?)
      AND NOT ${recentTargetEvent}
    ON CONFLICT (id) DO NOTHING
  `).bind(
    ...dispatchBinding(id, offer.kind, "member", senderName, target, now), ...presenceBinding(source, now),
    ...presenceBinding(target, now), offer.id, now, target.participantId, now - targetCooldown,
  );
  const consume = db.prepare(`
    UPDATE prank_offer SET used = 1 WHERE id = ? AND EXISTS (SELECT 1 FROM prank_event WHERE id = ?)
  `).bind(offer.id, id);
  const result = await db.batch<Dispatch>([insert, consume, dispatchRecord(db, id)]);
  return result[2].results[0];
}

export async function dispatchOrganizer(db: D1Database, id: string, kind: PrankKind, target: Presence & PrankTarget, now: number) {
  const insert = db.prepare(`
    ${insertDispatch}
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE ${livePresence}
      AND NOT ${recentTargetEvent}
      AND NOT EXISTS (SELECT 1 FROM prank_event WHERE sender_kind = 'organizer' AND created_at > ?)
    ON CONFLICT (id) DO NOTHING
  `).bind(
    ...dispatchBinding(id, kind, "organizer", "ThyrdDicks", target, now), ...presenceBinding(target, now),
    target.participantId, now - targetCooldown, now - organizerCooldown,
  );
  const result = await db.batch<Dispatch>([insert, dispatchRecord(db, id)]);
  return result[1].results[0];
}

export function publicDispatch(dispatch: Dispatch) {
  return {
    ok: true,
    eventId: dispatch.id,
    kind: dispatch.kind,
    target: { id: dispatch.targetId, name: dispatch.targetName, nickname: dispatch.targetNickname ?? undefined },
  };
}

export async function cleanPranks(db: D1Database, now: number) {
  await db.batch([
    db.prepare("DELETE FROM prank_presence WHERE expires_at <= ?").bind(now - leaveTtl),
    db.prepare("DELETE FROM prank_offer WHERE created_at <= ?").bind(now - retryRetention),
    db.prepare("DELETE FROM prank_event WHERE expires_at <= ?").bind(now - retryRetention),
  ]);
}
