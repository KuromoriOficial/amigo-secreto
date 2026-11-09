import { isSteamFriendCode, parseSteamGames } from "../steam-games";
import type { StoredParticipant } from "./git-store";
import { ApiError } from "./http";

export type ProfileFields = { photo?: unknown; steamCode?: unknown; games?: unknown; acceptPhoto?: unknown };

export function parseName(input: unknown) {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || [...name].length > 70 || /[\x00-\x1f\x7f]/.test(name)) {
    throw new ApiError(400, "Cada participante precisa de um nome com até 70 caracteres.");
  }
  return name;
}

export function parseNickname(input: unknown, name: string) {
  if (input === undefined) return undefined;
  const nickname = typeof input === "string" ? input.trim() : undefined;
  if (nickname === undefined || [...nickname].length > 70 || /[\x00-\x1f\x7f]/.test(nickname)) {
    throw new ApiError(400, `Use até 70 caracteres no apelido de ${name}.`);
  }
  return nickname || undefined;
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

export function parsePhoto(input: unknown, name: string) {
  if (!validPhoto(input)) throw new ApiError(400, `Adicione uma foto JPG, PNG ou WebP válida para ${name}.`);
  return input;
}

function optionalSteamCode(input: unknown) {
  const code = typeof input === "string" ? input.trim() : undefined;
  if (code === "") return undefined;
  if (!isSteamFriendCode(code)) throw new ApiError(400, "Informe um código de amigo Steam válido.");
  return code;
}

function optionalGames(input: unknown) {
  const games = parseSteamGames(input);
  if (!games) throw new ApiError(400, "Escolha até três jogos diferentes do catálogo da Steam.");
  return games;
}

export function updateProfile(person: StoredParticipant, fields: ProfileFields, participantConfirmed = false): StoredParticipant {
  const photo = fields.photo === undefined ? person.photo : parsePhoto(fields.photo, person.name);
  const steamCode = fields.steamCode === undefined ? person.steamCode : optionalSteamCode(fields.steamCode);
  const games = fields.games === undefined ? person.games : optionalGames(fields.games);
  let photoAccepted = photo === person.photo ? person.photoAccepted : undefined;
  if (participantConfirmed && (fields.acceptPhoto === true || fields.photo !== undefined)) photoAccepted = true;
  return { ...person, photo, photoAccepted, steamCode, games };
}

export function completeProfile(person: StoredParticipant) {
  return person.photoAccepted === true && !!person.photo && isSteamFriendCode(person.steamCode) && person.games?.length === 3;
}
