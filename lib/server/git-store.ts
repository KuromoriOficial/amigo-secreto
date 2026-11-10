import { env } from "cloudflare:workers";
import { Buffer } from "node:buffer";
import type { SealedAssignment } from "../offline-crypto";
import { isSteamFriendCode, parseSteamGames, type SteamGame } from "../steam-games";
import { ApiError } from "./http";
import type { AccessCredential, VaultCode } from "./vault";

declare global {
  namespace Cloudflare {
    interface Env {
      GITHUB_DATA_REPOSITORY?: string;
      GITHUB_DATA_TOKEN?: string;
      GITHUB_DATA_BRANCH?: string;
    }
  }
}

export type StoredParticipant = {
  id: string;
  name: string;
  nickname?: string;
  photo: string;
  code?: string;
  recipientId?: string;
  sealed?: SealedAssignment;
  access?: AccessCredential;
  browserSessions?: BrowserSession[];
  drawCode?: VaultCode;
  accessedAt?: string;
  revealedAt?: string;
  verifiedRevealRoundId?: string;
  steamCode?: string;
  games?: SteamGame[];
  unavailableDays: string[] | null;
};

export type BrowserSession = { fingerprint: string; accessIv: string; expiresAt: number };

export type DrawStatus = "draft" | "test" | "definitive" | "cancelled";

export type StoredEvent = {
  version: 1;
  drawn: boolean;
  drawStatus?: Exclude<DrawStatus, "draft">;
  drawId?: string;
  participants: StoredParticipant[];
};

export type StoredMemberComment = { id: string; participantId: string; authorId: string; text: string; createdAt: string };
type MemberComments = { version: 1; comments: StoredMemberComment[] };

type Configuration = { repositoryUrl: string; token: string; branch: string };
export type DataFile<T> = { name: string; commitMessage: string; parse: (encoded: string) => T; empty: () => T };
type Snapshot<T> = { sha?: string; etag?: string; value: T };

const maxFileBytes = 4_000_000;
const maxWriteAttempts = 4;
const memberCommentLimit = 240;

const eventFile: DataFile<StoredEvent> = {
  name: "amigo-secreto-2026.json",
  commitMessage: "Atualiza os dados do amigo secreto de 2026",
  parse: parseEvent,
  empty: () => ({ version: 1, drawn: false, participants: [] }),
};

const commentsFile: DataFile<MemberComments> = {
  name: "amigo-secreto-2026-comentarios.json",
  commitMessage: "Registra comentários de participantes do amigo secreto de 2026",
  parse: parseMemberComments,
  empty: () => ({ version: 1, comments: [] }),
};
const cachedEvent = createCachedFileReader(eventFile);

export function hasGitStorage() {
  return Boolean(env.GITHUB_DATA_REPOSITORY?.trim() && env.GITHUB_DATA_TOKEN?.trim());
}

function configuration(): Configuration {
  const repository = env.GITHUB_DATA_REPOSITORY?.trim();
  const token = env.GITHUB_DATA_TOKEN?.trim();
  if (!repository || !token) {
    throw new ApiError(503, "Configure o repositório privado e a credencial do GitHub no ambiente da API.");
  }

  const match = /^([a-z0-9-]+)\/([a-z0-9_.-]+)$/i.exec(repository);
  if (!match || match[2] === "." || match[2] === "..") {
    throw new ApiError(503, "Use o formato proprietário/repositório para configurar o GitHub.");
  }

  return {
    repositoryUrl: `https://api.github.com/repos/${match[1]}/${match[2]}`,
    token,
    branch: env.GITHUB_DATA_BRANCH?.trim() || "main",
  };
}

async function github(config: Configuration, path: string, method: "GET" | "PUT" = "GET", body?: string, etag?: string) {
  try {
    const headers = new Headers({
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${config.token}`,
      "User-Agent": "Amigo-Secreto-2026",
      "X-GitHub-Api-Version": "2026-03-10",
    });
    if (method === "PUT") headers.set("Content-Type", "application/json");
    if (method === "GET" && path.startsWith("/contents/")) {
      headers.set("Accept", "application/vnd.github.object+json");
    }
    if (etag) headers.set("If-None-Match", etag);

    return await fetch(`${config.repositoryUrl}${path}`, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch {
    throw new ApiError(503, "Não foi possível acessar o GitHub. Tente novamente em instantes.");
  }
}

async function discardBody(response: Response) {
  await response.body?.cancel().catch(() => undefined);
}

async function githubError(response: Response): Promise<never> {
  const rateLimited = response.status === 429 || response.headers.has("Retry-After") ||
    response.headers.get("X-RateLimit-Remaining") === "0";
  await discardBody(response);

  if (rateLimited) throw new ApiError(503, "O GitHub limitou os acessos por enquanto. Tente novamente mais tarde.");
  if ([401, 403, 404].includes(response.status)) {
    throw new ApiError(503, "Confira o repositório, a branch e as permissões da credencial do GitHub.");
  }
  throw new ApiError(503, "O GitHub não conseguiu acessar os dados do sorteio. Tente novamente.");
}

function invalidData() {
  return new ApiError(503, "O arquivo de dados do sorteio no GitHub é inválido.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSealedAssignment(value: unknown): value is SealedAssignment {
  return isRecord(value) &&
    typeof value.lookup === "string" && /^[a-f0-9]{64}$/.test(value.lookup) &&
    typeof value.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(value.iv) &&
    // A 36-byte UUID and 16-byte AES-GCM tag occupy 70 canonical base64url characters.
    typeof value.ciphertext === "string" && /^[A-Za-z0-9_-]{69}[AQgw]$/.test(value.ciphertext);
}

function isVaultCode(value: unknown, length: number): value is VaultCode {
  return isRecord(value) && typeof value.iv === "string" && /^[A-Za-z0-9_-]{16}$/.test(value.iv) &&
    typeof value.ciphertext === "string" && value.ciphertext.length === length && /^[A-Za-z0-9_-]+$/.test(value.ciphertext);
}

function isAccessCredential(value: unknown): value is AccessCredential {
  return isRecord(value) && typeof value.lookup === "string" && /^[a-f0-9]{64}$/.test(value.lookup) &&
    isVaultCode(value, 48);
}

function isBrowserSession(value: unknown): value is BrowserSession {
  return isRecord(value) && typeof value.fingerprint === "string" && /^[A-Za-z0-9_-]{43}$/.test(value.fingerprint) &&
    typeof value.accessIv === "string" && /^[A-Za-z0-9_-]{16}$/.test(value.accessIv) &&
    typeof value.expiresAt === "number" && Number.isSafeInteger(value.expiresAt) && value.expiresAt > 0;
}

async function githubObject(response: Response): Promise<Record<string, unknown>> {
  if (!response.ok) return githubError(response);
  const value: unknown = await response.json().catch(() => undefined);
  if (!isRecord(value)) throw invalidData();
  return value;
}

async function requirePrivateRepository(config: Configuration) {
  const repository = await githubObject(await github(config, ""));
  if (repository.private !== true || (repository.visibility && repository.visibility !== "private")) {
    throw new ApiError(503, "O repositório que guarda os dados do sorteio precisa ser privado.");
  }
}

function isParticipant(value: unknown): value is StoredParticipant {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string" &&
    (value.nickname === undefined || typeof value.nickname === "string") &&
    typeof value.photo === "string" && (value.code === undefined || typeof value.code === "string") &&
    (value.recipientId === undefined || typeof value.recipientId === "string") &&
    (value.sealed === undefined || isSealedAssignment(value.sealed)) &&
    (value.access === undefined || isAccessCredential(value.access)) &&
    (value.browserSessions === undefined || (Array.isArray(value.browserSessions) && value.browserSessions.every(isBrowserSession))) &&
    (value.drawCode === undefined || isVaultCode(value.drawCode, 62)) &&
    (value.accessedAt === undefined || typeof value.accessedAt === "string") &&
    (value.revealedAt === undefined || typeof value.revealedAt === "string") &&
    (value.verifiedRevealRoundId === "legacy" || isDrawId(value.verifiedRevealRoundId)) &&
    (value.steamCode === undefined || isSteamFriendCode(value.steamCode)) &&
    (value.games === undefined || parseSteamGames(value.games) !== null) &&
    (value.unavailableDays === null || (Array.isArray(value.unavailableDays) &&
      value.unavailableDays.every((day) => typeof day === "string")));
}

function isStoredDrawStatus(status: unknown, drawn: boolean): status is StoredEvent["drawStatus"] {
  return status === undefined || (drawn ? status === "test" || status === "definitive" : status === "cancelled");
}

function isDrawId(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value));
}

function parseJson(encoded: string): unknown {
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

function parseEvent(encoded: string): StoredEvent {
  let value: unknown;
  try { value = parseJson(encoded); } catch { throw invalidData(); }
  if (!isRecord(value) || value.version !== 1 || typeof value.drawn !== "boolean" ||
    !isStoredDrawStatus(value.drawStatus, value.drawn) || !isDrawId(value.drawId) ||
    !Array.isArray(value.participants) || !value.participants.every(isParticipant)) {
    throw invalidData();
  }
  return { version: 1, drawn: value.drawn, drawStatus: value.drawStatus, drawId: value.drawId, participants: value.participants };
}

function isMemberComment(value: unknown): value is StoredMemberComment {
  return isRecord(value) && typeof value.id === "string" && value.id.length === 36 &&
    typeof value.participantId === "string" && value.participantId.length > 0 &&
    typeof value.authorId === "string" && value.authorId.length > 0 &&
    typeof value.text === "string" && !!value.text.trim() && [...value.text].length <= memberCommentLimit &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function parseMemberComments(encoded: string): MemberComments {
  const invalid = () => new ApiError(503, "O arquivo de comentários do GitHub é inválido.");
  let value: unknown;
  try { value = parseJson(encoded); } catch { throw invalid(); }
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.comments) || !value.comments.every(isMemberComment)) {
    throw invalid();
  }
  return { version: 1, comments: value.comments };
}

async function readSnapshot<T>(config: Configuration, dataFile: DataFile<T>, previous?: Snapshot<T>): Promise<Snapshot<T>> {
  const branch = encodeURIComponent(config.branch);
  const response = await github(config, `/contents/${dataFile.name}?ref=${branch}`, "GET", undefined, previous?.etag);

  if (response.status === 304 && previous) return previous;

  if (response.status === 404) {
    await discardBody(response);
    // GitHub also uses 404 for a missing branch or insufficient read access.
    const targetBranch = await github(config, `/branches/${branch}`);
    if (!targetBranch.ok) return githubError(targetBranch);
    await discardBody(targetBranch);
    return { value: dataFile.empty() };
  }

  const file = await githubObject(response);
  if (file.type !== "file" || typeof file.sha !== "string" || !/^[a-f0-9]{40}$/.test(file.sha) ||
    typeof file.size !== "number" || file.size > maxFileBytes) {
    throw invalidData();
  }

  // Contents omits the bytes for files above 1 MB. The blob SHA pins the same
  // bytes used for conflict detection, even if the branch advances meanwhile.
  const content = file.encoding === "none"
    ? await githubObject(await github(config, `/git/blobs/${file.sha}`))
    : file;
  if (content.encoding !== "base64" || typeof content.content !== "string") throw invalidData();
  return { sha: file.sha, etag: response.headers.get("ETag") ?? undefined, value: dataFile.parse(content.content) };
}

function sameConfiguration(a: Configuration | undefined, b: Configuration) {
  return a?.repositoryUrl === b.repositoryUrl && a.token === b.token && a.branch === b.branch;
}

let privateCheck: { config: Configuration; expiresAt: number } | undefined;

async function requireCachedPrivateRepository(config: Configuration) {
  if (privateCheck && privateCheck.expiresAt > Date.now() && sameConfiguration(privateCheck.config, config)) {
    return;
  }
  await requirePrivateRepository(config);
  privateCheck = { config, expiresAt: Date.now() + 60_000 };
}

export function createCachedFileReader<T>(dataFile: DataFile<T>) {
  let config: Configuration | undefined;
  let snapshot: Snapshot<T> | undefined;
  let expiresAt = 0;
  let generation = 0;
  let appliedGeneration = 0;

  function invalidate() {
    snapshot = undefined;
    expiresAt = 0;
    appliedGeneration = ++generation;
  }

  async function read(force = false) {
    const current = configuration();
    if (!sameConfiguration(config, current)) invalidate();
    config = current;
    if (!force && snapshot && expiresAt > Date.now()) return snapshot.value;

    const previous = snapshot;
    const readGeneration = ++generation;
    await requireCachedPrivateRepository(current);
    const next = await readSnapshot(current, dataFile, previous);
    if (readGeneration > appliedGeneration) {
      snapshot = next;
      expiresAt = Date.now() + 5_000;
      appliedGeneration = readGeneration;
    }
    return next.value;
  }

  return { read, invalidate };
}

export async function readFile<T>(dataFile: DataFile<T>) {
  const config = configuration();
  await requirePrivateRepository(config);
  return (await readSnapshot(config, dataFile)).value;
}

export async function updateFile<T>(dataFile: DataFile<T>, change: (current: T) => T | Promise<T>) {
  const config = configuration();
  await requirePrivateRepository(config);
  let current = await readSnapshot(config, dataFile);

  for (let attempt = 0; attempt < maxWriteAttempts; attempt += 1) {
    const before = JSON.stringify(current.value);
    const updated = await change(current.value);
    const after = JSON.stringify(updated);
    if (current.sha && after === before) return updated;

    const bytes = Buffer.from(after, "utf8");
    if (bytes.byteLength > maxFileBytes) {
      throw new ApiError(413, "Os dados do sorteio ultrapassaram o limite de tamanho.");
    }

    const response = await github(config, `/contents/${dataFile.name}`, "PUT", JSON.stringify({
      message: dataFile.commitMessage,
      branch: config.branch,
      sha: current.sha,
      content: bytes.toString("base64"),
    }));

    if (response.ok) {
      await discardBody(response);
      return updated;
    }
    if (response.status !== 409 && response.status !== 422) return githubError(response);

    await discardBody(response);
    if (attempt === maxWriteAttempts - 1) break;

    const delay = 150 * 2 ** attempt + Math.floor(Math.random() * 150);
    await new Promise<void>((resolve) => setTimeout(resolve, delay));
    await requirePrivateRepository(config);
    const latest = await readSnapshot(config, dataFile);
    // A 422 with an unchanged SHA indicates validation or throttling, not a race.
    if (response.status === 422 && latest.sha === current.sha) {
      throw new ApiError(503, "O GitHub recusou a gravação dos dados. Tente novamente em instantes.");
    }
    current = latest;
  }

  throw new ApiError(409, "Outra resposta chegou ao mesmo tempo. Tente salvar novamente.");
}

export function readEvent() {
  return readFile(eventFile);
}

export function readEventForChat() {
  return cachedEvent.read();
}

export async function updateEvent(change: (current: StoredEvent) => StoredEvent | Promise<StoredEvent>) {
  const updated = await updateFile(eventFile, change);
  cachedEvent.invalidate();
  return updated;
}

export async function readMemberComments() {
  return (await readFile(commentsFile)).comments;
}
