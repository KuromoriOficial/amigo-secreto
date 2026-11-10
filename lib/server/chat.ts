import { appendChatMessage, chatSnapshot, chatSystemName, chatTextLimit, messageId, readChatPhoto, validMessageId, writeChatPhoto } from "./chat-store";
import { chatMemberSession } from "./event";
import { ApiError } from "./http";
import { validPhoto } from "./profile";

const firstPageSize = 50;
const requestIdPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

function chatText(input: unknown, allowEmpty = false) {
  const text = typeof input === "string" ? input.replace(/\r\n?/g, "\n").trim() : "";
  if ((!allowEmpty && !text) || (input !== undefined && typeof input !== "string") ||
    [...text].length > chatTextLimit || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new ApiError(400, `Escreva uma mensagem de até ${chatTextLimit} caracteres.`);
  }
  return text;
}

function requestKey(input: unknown) {
  if (input === undefined) return crypto.randomUUID();
  if (typeof input !== "string" || !requestIdPattern.test(input)) throw new ApiError(400, "O identificador do envio é inválido.");
  return input.toLowerCase();
}

export async function listChat(sessionToken: unknown, after: unknown) {
  await chatMemberSession(sessionToken);
  if (after !== undefined && (typeof after !== "number" || !Number.isSafeInteger(after) || after < 0)) {
    throw new ApiError(400, "A posição do chat é inválida.");
  }

  const { messages, sequence: cursor } = await chatSnapshot();
  const first = messages[0]?.sequence ?? cursor + 1;
  const reset = after !== undefined && (after > cursor || after < first - 1);
  const page = after === undefined || reset ? messages.slice(-firstPageSize) : messages.filter(({ sequence }) => sequence > after);
  return { messages: page, cursor, reset: reset || undefined };
}

export async function sendChat(sessionToken: unknown, textInput: unknown, photoInput: unknown, requestId: unknown) {
  const { viewer } = await chatMemberSession(sessionToken, true);
  const text = chatText(textInput, true);
  let photo: string | undefined;
  if (photoInput !== undefined) {
    if (!validPhoto(photoInput)) throw new ApiError(400, "Envie uma foto JPG, PNG ou WebP menor.");
    photo = photoInput;
  }
  if (!text && !photo) throw new ApiError(400, "Escreva uma mensagem ou adicione uma foto.");

  const id = await messageId(`member:${viewer.id}`, requestKey(requestId));
  if (photo) await writeChatPhoto(id, photo);
  return appendChatMessage({
    id,
    kind: "member",
    authorId: viewer.id,
    authorName: viewer.name,
    authorNickname: viewer.nickname,
    text,
    hasPhoto: !!photo,
    createdAt: new Date().toISOString(),
  });
}

export async function chatPhoto(sessionToken: unknown, input: unknown) {
  await chatMemberSession(sessionToken);
  if (!validMessageId(input)) throw new ApiError(404, "Foto não encontrada.");
  let message = (await chatSnapshot()).messages.find(({ id }) => id === input);
  if (!message) message = (await chatSnapshot(true)).messages.find(({ id }) => id === input);
  if (!message?.hasPhoto) throw new ApiError(404, "Foto não encontrada.");
  return readChatPhoto(input);
}

export async function chatAvatar(sessionToken: unknown, authorId: unknown) {
  const { event } = await chatMemberSession(sessionToken);
  const person = event.participants.find(({ id }) => id === authorId);
  if (!person?.photo) throw new ApiError(404, "Foto não encontrada.");
  return { photo: person.photo };
}

export async function announceChat(input: unknown, requestId: unknown) {
  const text = chatText(input);
  return appendChatMessage({
    id: await messageId("announcement", requestKey(requestId)),
    kind: "announcement",
    authorName: chatSystemName,
    text,
    hasPhoto: false,
    createdAt: new Date().toISOString(),
  });
}
