import { reveal } from "@/lib/server/event";
import { endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    return reveal(await readBody(request, 1024));
  });
}
