import { DurableObject } from "cloudflare:workers";

export class Room extends DurableObject<Env> {}

export default {
  async fetch(request, _env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/health") {
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
