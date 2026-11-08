import { organizerState, requireOrganizer, updateRoster } from "@/lib/server/event";
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
    const { action, participants } = await readBody(request, 3_300_000);
    return updateRoster(action, participants);
  });
}
