import { memberDirectory } from "./event";
import { readMemberComments, type StoredMemberComment } from "./git-store";
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
