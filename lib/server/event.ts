import { env } from "cloudflare:workers";
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
const profiles = [
  { name: "Luiza Martins", photo: "/demo/luiza.svg" },
  { name: "Rafael Costa", photo: "/demo/rafael.svg" },
  { name: "Beatriz Almeida", photo: "/demo/beatriz.svg" },
  { name: "Pedro Lima", photo: "/demo/pedro.svg" },
];

const dates = Array.from({ length: 61 }, (_, offset) =>
  new Date(Date.UTC(2026, 10, offset + 1)).toISOString().slice(0, 10),
);
const eventDates = new Set(dates);

type Mode = "demo" | "live";
type Profile = { name: string; photo: string };
type SavedParticipant = Profile & { id: string; code: string | null; unavailable_days: string | null };

function requireDatabase() {
  if (!env.DB) throw new ApiError(503, "O banco de dados do evento ainda não foi configurado.");
  return env.DB;
}

async function eventMode(): Promise<Mode> {
  const state = await env.DB?.prepare("SELECT drawn FROM event WHERE id = 1").first<number>("drawn");
  return state === 1 ? "live" : "demo";
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

function savedDays(value: string | null): string[] {
  return value === null ? [] : JSON.parse(value);
}

export async function publicEvent() {
  return { mode: await eventMode() };
}

export async function reveal(input: unknown) {
  const code = numericCode(input);
  const mode = await eventMode();

  if (mode === "live" && code.length === 12) {
    const match = await requireDatabase().prepare(`
      SELECT friend.name, friend.photo, voter.unavailable_days
      FROM participant AS voter
      JOIN participant AS friend ON friend.id = voter.recipient_id
      WHERE voter.code = ?
    `).bind(code).first<Profile & { unavailable_days: string | null }>();

    if (match) {
      return {
        person: { name: match.name, photo: match.photo },
        canSave: true,
        days: savedDays(match.unavailable_days),
        mode,
      };
    }
  }

  const demoMatch = mode === "demo" && code === demoCode;
  return {
    person: demoMatch ? profiles[0] : profiles[randomIndex(profiles.length)],
    canSave: demoMatch,
    days: [],
    mode,
  };
}

export async function saveAvailability(codeInput: unknown, daysInput: unknown) {
  const code = numericCode(codeInput);
  const days = unavailableDays(daysInput);
  if (code.length !== 12) throw new ApiError(403, "Use o código do sorteio para registrar suas datas.");

  const result = await requireDatabase().prepare(`
    UPDATE participant SET unavailable_days = ? WHERE code = ?
  `).bind(JSON.stringify(days), code).run();

  if (result.meta.changes !== 1) {
    throw new ApiError(403, "Use o código do sorteio para registrar suas datas.");
  }

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
  const db = requireDatabase();
  const [state, roster] = await db.batch([
    db.prepare("SELECT drawn FROM event WHERE id = 1"),
    db.prepare("SELECT id, name, photo, code, unavailable_days FROM participant ORDER BY position"),
  ]);

  const event = state.results[0] as { drawn: number } | undefined;
  const phase = event?.drawn === 1 ? "drawn" : "draft";
  const rows = roster.results as SavedParticipant[];
  const unavailableCounts = new Map<string, number>();
  let responseCount = 0;

  const participants = rows.map((row) => {
    const responded = row.unavailable_days !== null;
    if (responded) {
      responseCount += 1;
      for (const day of savedDays(row.unavailable_days)) {
        unavailableCounts.set(day, (unavailableCounts.get(day) ?? 0) + 1);
      }
    }

    return { id: row.id, name: row.name, photo: row.photo, code: row.code ?? undefined, responded };
  });

  return {
    phase,
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
    if (!validPhoto(profile?.photo)) {
      throw new ApiError(400, `Adicione uma foto JPG, PNG ou WebP válida para ${name}.`);
    }
    return { name, photo: profile.photo };
  });
}

function assignRecipients(ids: string[]) {
  const recipients = [...ids];
  do {
    for (let index = recipients.length - 1; index > 0; index -= 1) {
      const other = randomIndex(index + 1);
      [recipients[index], recipients[other]] = [recipients[other], recipients[index]];
    }
  } while (recipients.some((recipient, index) => recipient === ids[index]));

  return recipients;
}

function uniqueCodes(size: number) {
  const codes = new Set<string>();
  while (codes.size < size) {
    const code = Array.from({ length: 12 }, () => randomIndex(10)).join("");
    codes.add(code);
  }
  return [...codes];
}

export async function updateRoster(action: unknown, input: unknown) {
  if (action !== "save" && action !== "draw") throw new ApiError(400, "Ação inválida.");

  const db = requireDatabase();
  const roster = validateRoster(input);
  const drawing = action === "draw";
  if (drawing && roster.length < 2) throw new ApiError(400, "Cadastre pelo menos duas pessoas para sortear.");

  const ids = roster.map(() => crypto.randomUUID());
  const recipients = drawing ? assignRecipients(ids) : [];
  const codes = drawing ? uniqueCodes(roster.length) : [];
  const guard = "(SELECT drawn FROM event WHERE id = 1) = 0";

  // The guarded batch replaces the roster and activates the draw as one transaction.
  // Concurrent attempts after a successful draw make no changes.
  const results = await db.batch([
    db.prepare("INSERT OR IGNORE INTO event (id) VALUES (1)"),
    db.prepare(`DELETE FROM participant WHERE ${guard}`),
    ...roster.map((person, index) => db.prepare(`
      INSERT INTO participant (id, name, photo, position, code, recipient_id)
      SELECT ?, ?, ?, ?, ?, ? WHERE ${guard}
    `).bind(ids[index], person.name, person.photo, index, codes[index] ?? null, recipients[index] ?? null)),
    db.prepare("UPDATE event SET drawn = ? WHERE id = 1 AND drawn = 0").bind(drawing ? 1 : 0),
  ]);

  if (results.at(-1)?.meta.changes !== 1) {
    throw new ApiError(409, "O sorteio já aconteceu e a lista foi encerrada.");
  }

  return organizerState();
}
