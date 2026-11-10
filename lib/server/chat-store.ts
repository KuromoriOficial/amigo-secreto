import { Buffer } from "node:buffer";
import { createCachedFileReader, readFile, updateFile, type DataFile } from "./git-store";
import { ApiError } from "./http";
import { validPhoto } from "./profile";

export type ChatMessage = {
  id: string;
  sequence: number;
  kind: "member" | "system" | "announcement";
  authorId?: string;
  authorName: string;
  authorNickname?: string;
  text: string;
  hasPhoto: boolean;
  createdAt: string;
};

type ChatDocument = { version: 1; sequence: number; messages: ChatMessage[] };
type ChatPhoto = { version: 1; photo: string | null };
type NewMessage = Omit<ChatMessage, "sequence">;

export const chatTextLimit = 500;
export const chatSystemName = "ThyrdDicks";
const historyLimit = 250;
const messageIdPattern = /^[a-f0-9]{64}$/;
const photoDirectory = "amigo-secreto-2026-chat-fotos";
const encoder = new TextEncoder();

const chatFile: DataFile<ChatDocument> = {
  name: "amigo-secreto-2026-chat.json",
  commitMessage: "Atualiza o chat do amigo secreto de 2026",
  parse: parseChat,
  empty: () => ({ version: 1, sequence: 0, messages: [] }),
};
const cachedChat = createCachedFileReader(chatFile);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function chatJson(encoded: string): unknown {
  try {
    return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  } catch {
    throw new ApiError(503, "O arquivo do chat no GitHub é inválido.");
  }
}

export function validMessageId(value: unknown): value is string {
  return typeof value === "string" && messageIdPattern.test(value);
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value) && validMessageId(value.id) && typeof value.sequence === "number" &&
    Number.isSafeInteger(value.sequence) && value.sequence > 0 &&
    (value.kind === "member" || value.kind === "system" || value.kind === "announcement") &&
    (value.authorId === undefined || typeof value.authorId === "string") &&
    typeof value.authorName === "string" && (value.authorNickname === undefined || typeof value.authorNickname === "string") &&
    typeof value.text === "string" && [...value.text].length <= chatTextLimit && typeof value.hasPhoto === "boolean" &&
    typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt));
}

function parseChat(encoded: string): ChatDocument {
  const document = chatJson(encoded);
  if (!isRecord(document) || document.version !== 1 || typeof document.sequence !== "number" ||
    !Number.isSafeInteger(document.sequence) || document.sequence < 0 || !Array.isArray(document.messages) ||
    document.messages.length > historyLimit || !document.messages.every(isChatMessage)) {
    throw new ApiError(503, "O arquivo do chat no GitHub é inválido.");
  }
  const messages = document.messages.map(({ id, sequence, kind, authorId, authorName, authorNickname, text, hasPhoto, createdAt }) => ({
    id, sequence, kind, authorId, authorName, authorNickname, text, hasPhoto, createdAt,
  }));
  return { version: 1, sequence: document.sequence, messages };
}

function photoFile(id: string): DataFile<ChatPhoto> {
  if (!validMessageId(id)) throw new ApiError(404, "Foto não encontrada.");
  return {
    name: `${photoDirectory}/${id}.json`,
    commitMessage: "Adiciona uma foto ao chat do amigo secreto de 2026",
    empty: () => ({ version: 1, photo: null }),
    parse(encoded) {
      const value = chatJson(encoded);
      if (!isRecord(value) || value.version !== 1 || !validPhoto(value.photo)) {
        throw new ApiError(503, "A foto do chat no GitHub é inválida.");
      }
      return { version: 1, photo: value.photo };
    },
  };
}

export async function messageId(scope: string, key: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`amigo-secreto-2026:chat:v1:${scope}:${key}`));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function chatSnapshot(force = false) {
  return cachedChat.read(force);
}

export async function appendChatMessage(message: NewMessage) {
  const document = await updateFile(chatFile, (current) => {
    const previous = current.messages.find(({ id }) => id === message.id);
    if (previous) {
      if (previous.kind !== message.kind || previous.authorId !== message.authorId || previous.text !== message.text ||
        previous.hasPhoto !== message.hasPhoto) {
        throw new ApiError(409, "Este envio já foi usado. Inicie uma nova mensagem para alterar o conteúdo.");
      }
      return current;
    }

    const sequence = current.sequence + 1;
    return { ...current, sequence, messages: [...current.messages, { ...message, sequence }].slice(-historyLimit) };
  });
  cachedChat.invalidate();
  const saved = document.messages.find(({ id }) => id === message.id);
  if (!saved) throw new ApiError(503, "Não foi possível localizar a mensagem no chat.");
  return { message: saved };
}

export async function writeChatPhoto(id: string, photo: string) {
  await updateFile(photoFile(id), (current) => {
    if (current.photo && current.photo !== photo) {
      throw new ApiError(409, "Este envio já possui outra foto. Inicie uma nova mensagem para trocá-la.");
    }
    return current.photo ? current : { version: 1 as const, photo };
  });
}

export async function readChatPhoto(id: string) {
  const { photo } = await readFile(photoFile(id));
  if (!photo) throw new ApiError(404, "Foto não encontrada.");
  return { photo };
}

export async function postSystemMessage(text: string, key: string) {
  await appendChatMessage({
    id: await messageId("system", key),
    kind: "system",
    authorName: chatSystemName,
    text,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
  });
}
