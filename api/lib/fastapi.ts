// Bridge to the FastAPI AI Caller backend (the Python service that owns
// the Twilio creds, the WebSocket gateway, and the call lifecycle).
//
// The admin is a control panel — it doesn't talk to Twilio directly. It
// talks to FastAPI which talks to Twilio. The FastAPI service is the
// source of truth for call placement, transcript, and recording.

import { TRPCError } from "@trpc/server";

export type FastApiCreds = {
  url: string; // e.g. "https://ai-caller-api-82u7.onrender.com"
  adminKey: string; // X-API-Key header value
};

export async function callFastApi(
  creds: FastApiCreds,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (!creds.url || !creds.adminKey) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "FastAPI backend is not configured. Add the FastAPI URL + admin key in Settings.",
    });
  }
  const baseUrl = creds.url.replace(/\/$/, "");
  const url = `${baseUrl}${path}`;
  const headers = new Headers(init.headers);
  headers.set("X-API-Key", creds.adminKey);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, { ...init, headers });
  return res;
}

export async function callFastApiJson<T = any>(
  creds: FastApiCreds,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await callFastApi(creds, path, init);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `FastAPI ${res.status}: ${text.slice(0, 500)}`,
    });
  }
  return (await res.json()) as T;
}
