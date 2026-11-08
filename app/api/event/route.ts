import { publicEvent } from "@/lib/server/event";
import { endpoint } from "@/lib/server/http";

export const dynamic = "force-dynamic";

export function GET() {
  return endpoint(publicEvent);
}
