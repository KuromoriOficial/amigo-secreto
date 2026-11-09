import { auditPairs, editParticipant, generateAccessCodes, importOfflineDraw, organizerState, registerDrawCodes, requireOrganizer, updateRoster } from "@/lib/server/event";
import { endpoint, readBody } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return endpoint(async () => {
    await requireOrganizer(request);
    return organizerState();
  });
}

export function POST(request: Request) {
  return endpoint(async () => {
    await requireOrganizer(request);
    const body = await readBody(request, 3_300_000);
    switch (body.action) {
      case "import": return importOfflineDraw(body.draw, body.drawCodes);
      case "register-codes": return registerDrawCodes(body.drawCodes);
      case "credentials": return generateAccessCodes();
      case "edit-profile": return editParticipant(body);
      case "audit": return auditPairs(body.confirmation);
      default: return updateRoster(body.action, body.participants);
    }
  });
}
