import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { HttpBindings } from "@hono/node-server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter, oauthCallbackRoutes, oauthCallbackHandler } from "./router";
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
// Register the OAuth callback handler directly on the main app. Mounting
// via app.route() was returning 404 in production (worked locally), so
// we register the handler inline.
// NOTE: catch-all /api/* is registered BEFORE the specific routes
// because in production, the specific routes were getting shadowed by
// the catch-all when registered in the normal order. This is a Hono
// router quirk we discovered while debugging the OAuth callback 404.
// app.all("/api/*", (c) => c.json({ error: "Not Found" }, 404));

// Alternative: try a completely different path
app.get("/api/oauth-assistant/callback", (c) => {
  console.log("[OAuth] alt callback hit, provider=", c.req.query("provider"));
  return oauthCallbackHandler(c);
});

// Test: simple handler at /api/oauth-test
app.get("/api/oauth-test", (c) => c.text("oauth-test works"));

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
