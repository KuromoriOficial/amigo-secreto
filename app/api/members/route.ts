import { memberDirectory } from "@/lib/server/event";
import { ApiError, endpoint, readBody } from "@/lib/server/http";
import { memberProfile } from "@/lib/server/members";

export function POST(request: Request) {
  return endpoint(async () => {
    const body = await readBody(request, 4096);
    switch (body.action) {
      case "list": return memberDirectory(body.sessionToken);
      case "profile": return memberProfile(body.sessionToken, body.participantId);
      case "comment": throw new ApiError(410, "Os comentários de perfil foram encerrados. Use o chat do grupo.");
      default: throw new ApiError(400, "Ação inválida.");
    }
  });
}
