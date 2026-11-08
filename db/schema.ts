import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const event = sqliteTable("event", {
  id: integer("id").primaryKey(),
  drawn: integer("drawn", { mode: "boolean" }).notNull().default(false),
});

export const participant = sqliteTable("participant", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  photo: text("photo").notNull(),
  position: integer("position").notNull(),
  code: text("code").unique(),
  recipientId: text("recipient_id"),
  unavailableDays: text("unavailable_days"),
});
