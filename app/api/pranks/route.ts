import { ApiError, endpoint, readBody } from "@/lib/server/http";
import { heartbeat, leavePresence, sendMemberPrank } from "@/lib/server/pranks";

export function POST(request: Request) {
  return endpoint(async () => {
    const body = await readBody(request, 2048);
    switch (body.action) {
      case "heartbeat": return heartbeat(body);
      case "leave": return leavePresence(body);
      case "send": return sendMemberPrank(body);
      default: throw new ApiError(400, "Ação inválida.");
    }
  });
}
