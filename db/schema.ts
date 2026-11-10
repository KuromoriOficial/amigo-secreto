import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const prankPresence = sqliteTable("prank_presence", {
  sessionKey: text("session_key").notNull(),
  tabId: text("tab_id").notNull(),
  participantId: text("participant_id").notNull(),
  sequence: integer("sequence").notNull(),
  epoch: integer("epoch").notNull(),
  visible: integer("visible", { mode: "boolean" }).notNull(),
  updatedAt: integer("updated_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, (table) => [
  primaryKey({ columns: [table.sessionKey, table.tabId] }),
  index("prank_presence_live_idx").on(table.visible, table.expiresAt),
]);

export const prankOffer = sqliteTable("prank_offer", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["tomato", "scare"] }).notNull(),
  sourceParticipantId: text("source_participant_id").notNull(),
  sourceSessionKey: text("source_session_key").notNull(),
  sourceTabId: text("source_tab_id").notNull(),
  sourceEpoch: integer("source_epoch").notNull(),
  targetParticipantId: text("target_participant_id").notNull(),
  targetSessionKey: text("target_session_key").notNull(),
  targetTabId: text("target_tab_id").notNull(),
  targetEpoch: integer("target_epoch").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  used: integer("used", { mode: "boolean" }).notNull().default(false),
}, (table) => [index("prank_offer_source_idx").on(table.sourceParticipantId, table.createdAt)]);

export const prankEvent = sqliteTable("prank_event", {
  id: text("id").primaryKey(),
  kind: text("kind", { enum: ["tomato", "scare"] }).notNull(),
  senderKind: text("sender_kind", { enum: ["member", "organizer"] }).notNull(),
  senderName: text("sender_name").notNull(),
  targetParticipantId: text("target_participant_id").notNull(),
  targetName: text("target_name").notNull(),
  targetNickname: text("target_nickname"),
  targetSessionKey: text("target_session_key").notNull(),
  targetTabId: text("target_tab_id").notNull(),
  targetEpoch: integer("target_epoch").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
  claimedAt: integer("claimed_at"),
}, (table) => [
  index("prank_event_delivery_idx").on(table.targetSessionKey, table.targetTabId, table.targetEpoch, table.claimedAt, table.expiresAt),
  index("prank_event_target_idx").on(table.targetParticipantId, table.createdAt),
  index("prank_event_sender_idx").on(table.senderKind, table.createdAt),
]);
