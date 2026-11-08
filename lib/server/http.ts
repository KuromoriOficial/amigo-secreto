export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export async function endpoint(handler: () => Promise<unknown>) {
  try {
    return json(await handler());
  } catch (error) {
    if (error instanceof ApiError) {
      return json({ error: error.message }, error.status);
    }

    return json({ error: "O serviço está indisponível no momento. Tente novamente." }, 503);
  }
}

export async function readBody(request: Request, maxBytes: number): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let content = "";

  while (reader) {
    const { value, done } = await reader.read();
    if (done) break;

    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new ApiError(413, "Os dados enviados ultrapassam o limite permitido.");
    }
    content += decoder.decode(value, { stream: true });
  }

  try {
    const body: unknown = JSON.parse(content + decoder.decode());
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // Return the same validation message for malformed JSON and non-object bodies.
  }

  throw new ApiError(400, "Os dados enviados são inválidos.");
}
