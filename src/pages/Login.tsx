// Login page — Kimi OAuth + dev login fallback.
//
// The dev login form appears below the Kimi button when:
//  - VITE_ALLOW_DEV_LOGIN is set, OR
//  - we're on localhost
//
// Dev login posts to /api/trpc/auth.devLogin, which creates the user + tenant
// (if needed) and returns a session cookie. Useful for demoing the app
// without setting up Kimi OAuth.

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/providers/trpc";
import { toast } from "sonner";

function getOAuthUrl() {
  const kimiAuthUrl = import.meta.env.VITE_KIMI_AUTH_URL;
  const appID = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${kimiAuthUrl}/api/oauth/authorize`);
  url.searchParams.set("client_id", appID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "profile");
  url.searchParams.set("state", state);

  return url.toString();
}

export default function Login() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [tenantSlug, setTenantSlug] = useState("premium-meridian");

  const devLogin = trpc.auth.devLogin.useMutation({
    onSuccess: () => {
      toast.success("Logged in. Redirecting…");
      // Reload so the auth context picks up the new cookie
      window.location.href = "/";
    },
    onError: (e) => toast.error(e.message),
  });

  const allowDevLogin =
    import.meta.env.VITE_ALLOW_DEV_LOGIN === "1" ||
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1";

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>AI Caller Admin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            onClick={() => {
              window.location.href = getOAuthUrl();
            }}
          >
            Sign in with Kimi
          </Button>

          {allowDevLogin && (
            <>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">
                    Or dev login
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Email</Label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="david@premiummeridian.org"
                />
              </div>
              <div className="space-y-2">
                <Label>Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="David Lockhart"
                />
              </div>
              <div className="space-y-2">
                <Label>Tenant slug</Label>
                <Input
                  value={tenantSlug}
                  onChange={(e) => setTenantSlug(e.target.value)}
                  placeholder="premium-meridian"
                />
                <p className="text-xs text-muted-foreground">
                  Creates the tenant if it doesn't exist. Default: premium-meridian.
                </p>
              </div>
              <Button
                className="w-full"
                variant="secondary"
                size="lg"
                disabled={!email || !name || devLogin.isPending}
                onClick={() => devLogin.mutate({ email, name, tenantSlug })}
              >
                {devLogin.isPending ? "Signing in…" : "Dev login (no Kimi)"}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Dev login is auto-enabled on localhost. In production, set
                VITE_ALLOW_DEV_LOGIN=1 and DEV_LOGIN=1 on the server.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
