import { loginParticipant, logoutParticipant, recordSeen, resumeParticipant, saveParticipantProfile } from "@/lib/server/event";
import { ApiError, endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const body = await readBody(request, 125_000);
    switch (body.action) {
      case "login": return loginParticipant(body.accessCode, body.remember);
      case "resume": return resumeParticipant(body.sessionToken);
      case "logout": return logoutParticipant(body.sessionToken);
      case "profile": return saveParticipantProfile(body);
      case "seen": return recordSeen(body);
      default: throw new ApiError(400, "Ação inválida.");
    }
  });
}
