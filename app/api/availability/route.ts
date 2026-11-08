import { saveAvailability } from "@/lib/server/event";
import { endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const { code, days } = await readBody(request, 4096);
    return saveAvailability(code, days);
  });
}
