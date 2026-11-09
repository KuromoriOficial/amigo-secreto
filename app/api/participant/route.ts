import { loginParticipant, recordSeen, saveParticipantProfile } from "@/lib/server/event";
import { ApiError, endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const body = await readBody(request, 125_000);
    switch (body.action) {
      case "login": return loginParticipant(body.accessCode);
      case "profile": return saveParticipantProfile(body.accessCode, body);
      case "seen": return recordSeen(body.accessCode, body.code);
      default: throw new ApiError(400, "Ação inválida.");
    }
  });
}
