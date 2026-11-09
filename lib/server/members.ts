import { memberDirectory } from "./event";
import { MEMBER_COMMENT_LIMIT, addMemberComment, readMemberComments, type StoredMemberComment } from "./git-store";
import { ApiError } from "./http";

type Directory = Awaited<ReturnType<typeof memberDirectory>>;

function findMember(directory: Directory, participantId: unknown) {
  const member = directory.members.find(({ id }) => id === participantId);
  if (!member) throw new ApiError(404, "Perfil não encontrado.");
  return member;
}

function publicComment(comment: StoredMemberComment, directory: Directory) {
  const author = directory.members.find(({ id }) => id === comment.authorId);
  return {
    id: comment.id,
    authorId: comment.authorId,
    authorName: author?.name ?? "Participante",
    authorNickname: author?.nickname,
    text: comment.text,
    createdAt: comment.createdAt,
  };
}

function commentText(input: unknown) {
  const text = typeof input === "string" ? input.replace(/\r\n?/g, "\n").trim() : "";
  if (!text || [...text].length > MEMBER_COMMENT_LIMIT || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)) {
    throw new ApiError(400, `Escreva um comentário de até ${MEMBER_COMMENT_LIMIT} caracteres.`);
  }
  return text;
}

export async function memberProfile(sessionToken: unknown, participantId: unknown) {
  const directory = await memberDirectory(sessionToken);
  const member = findMember(directory, participantId);
  const comments = (await readMemberComments())
    .filter((comment) => comment.participantId === member.id)
    .reverse()
    .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
    .map((comment) => publicComment(comment, directory));
  return { member, comments };
}

export async function postMemberComment(sessionToken: unknown, participantId: unknown, input: unknown) {
  const directory = await memberDirectory(sessionToken);
  const member = findMember(directory, participantId);
  const comment = {
    id: crypto.randomUUID(),
    participantId: member.id,
    authorId: directory.viewerId,
    text: commentText(input),
    createdAt: new Date().toISOString(),
  };
  await addMemberComment(comment);
  return { comment: publicComment(comment, directory) };
}
