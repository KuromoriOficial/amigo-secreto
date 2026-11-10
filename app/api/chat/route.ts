import { chatAvatar, chatPhoto, listChat, sendChat } from "@/lib/server/chat";
import { ApiError, endpoint, readBody } from "@/lib/server/http";

export function POST(request: Request) {
  return endpoint(async () => {
    const body = await readBody(request, 125_000);
    switch (body.action) {
      case "list": return listChat(body.sessionToken, body.after);
      case "send": return sendChat(body.sessionToken, body.text, body.photo, body.requestId);
      case "photo": return chatPhoto(body.sessionToken, body.messageId);
      case "avatar": return chatAvatar(body.sessionToken, body.authorId);
      default: throw new ApiError(400, "Ação inválida.");
    }
  });
}
