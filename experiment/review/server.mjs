// Local blinded review page: `pnpm review` → http://localhost:5300
// Serves only the blinded packet and saves responses; never reads the unblinding key.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const packetFile = path.join(dir, "packet.json");
const responsesFile = path.join(dir, "responses.json");
const port = Number(process.env.PORT ?? 5300);

const send = (res, status, body, type = "application/json") => {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
};

http
  .createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") return send(res, 200, fs.readFileSync(path.join(dir, "review.html"), "utf8"), "text/html");
    if (req.url === "/packet.json") return send(res, 200, fs.readFileSync(packetFile, "utf8"));
    if (req.url === "/responses.json" && req.method === "GET") {
      return send(res, 200, fs.existsSync(responsesFile) ? fs.readFileSync(responsesFile, "utf8") : JSON.stringify({ reviewer: null, responses: {} }));
    }
    if (req.url === "/responses.json" && req.method === "POST") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        try {
          const data = JSON.parse(body);
          fs.writeFileSync(responsesFile, `${JSON.stringify({ ...data, savedAt: new Date().toISOString() }, null, 2)}\n`);
          send(res, 200, { ok: true });
        } catch {
          send(res, 400, { ok: false });
        }
      });
      return;
    }
    send(res, 404, { error: "not found" });
  })
  .listen(port, () => console.log(`Blinded review: http://localhost:${port}`));
