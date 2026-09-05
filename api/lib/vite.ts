import type { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import fs from "fs";
import path from "path";

type App = Hono<{ Bindings: HttpBindings }>;

export function serveStaticFiles(app: App) {
  const distPath = path.resolve(import.meta.dirname, "../dist/public");

  // Serve static files ONLY for non-API paths. API paths need to fall through
  // to the registered routes (e.g. /api/assistant/integrations/callback).
  // Without this filter, the serveStatic middleware would catch /api/...
  // requests, not find a file, and return 404 before the routes can match.
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) {
      return next();
    }
    return serveStatic({ root: "./dist/public" })(c, next);
  });

  app.notFound((c) => {
    const accept = c.req.header("accept") ?? "";
    if (!accept.includes("text/html")) {
      return c.json({ error: "Not Found" }, 404);
    }
    const indexPath = path.resolve(distPath, "index.html");
    const content = fs.readFileSync(indexPath, "utf-8");
    return c.html(content);
  });
}
