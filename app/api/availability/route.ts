import { saveAvailability } from "@/lib/server/event";
import { endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    return saveAvailability(await readBody(request, 4096));
  });
}
