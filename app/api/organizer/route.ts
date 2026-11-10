import { announceChat } from "@/lib/server/chat";
import { auditPairs, cancelDraw, editParticipant, generateAccessCodes, importOfflineDraw, organizerState, registerDrawCodes, requireOrganizer, resetDraw, updateRoster } from "@/lib/server/event";
import { endpoint, readBody } from "@/lib/server/http";
import { organizerPrankPresence, sendOrganizerPrank } from "@/lib/server/pranks";

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
      case "import": return importOfflineDraw(body.draw, body.drawCodes, body.kind);
      case "cancel-draw": return cancelDraw();
      case "reset-draw": return resetDraw();
      case "register-codes": return registerDrawCodes(body.drawCodes);
      case "credentials": return generateAccessCodes();
      case "edit-profile": return editParticipant(body);
      case "announce": return announceChat(body.text, body.requestId);
      case "prank-presence": return organizerPrankPresence();
      case "prank": return sendOrganizerPrank(body);
      case "audit": return auditPairs(body.confirmation);
      default: return updateRoster(body.action, body.participants);
    }
  });
}
