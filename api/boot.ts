import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, oauthCallbackRoutes } from "./router";
import { webhooks } from "./webhooks";
import { createContext } from "./context";
import { env } from "./lib/env";
import { createOAuthCallbackHandler } from "./kimi/auth";
import { Paths } from "@contracts/constants";

const app = new Hono<{ Bindings: HttpBindings }>();

app.use(bodyLimit({ maxSize: 50 * 1024 * 1024 }));
app.get("/api/test/version", (c) => c.json({ 
  version: "1.0",
  buildTime: new Date().toISOString(),
  oauthCallbackPath: "/api/assistant/integrations/callback",
  env: process.env.NODE_ENV,
  publicBaseUrl: process.env.PUBLIC_BASE_URL,
}));
app.get(Paths.oauthCallback, createOAuthCallbackHandler());
app.route("/api/webhooks", webhooks);
app.use("/api/trpc/*", async (c) => {
  return fetchRequestHandler({
    endpoint: "/api/trpc",
    req: c.req.raw,
    router: appRouter,
    createContext,
  });
});
// Register OAuth callback routes directly on the main app. We tried
// mounting via app.route("/api/assistant", oauthCallbackRoutes) but
// something about Hono's routing in production caused 404s. Inline
// registration works reliably.
app.get("/api/assistant/integrations/callback", async (c) => {
  // Re-export the handler from oauthCallbackRoutes. We do this by
  // calling the same handler logic.
  const innerApp = oauthCallbackRoutes;
  // Re-create a fake request and run it through the inner app
  const url = new URL(c.req.url);
  const newReq = new Request(url.toString(), c.req.raw);
  return innerApp.fetch(newReq, c.env, c.executionCtx);
});
app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

export default app;

if (env.isProduction) {
  const { serve } = await import("@hono/node-server");
  const { serveStaticFiles } = await import("./lib/vite");
  serveStaticFiles(app);

  const port = parseInt(process.env.PORT || "3000");
  serve({ fetch: app.fetch, port }, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
