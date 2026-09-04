// Tenant preview context — used by the platform owner (role=owner) to view
// the dashboard as a different tenant.
//
// How it works:
//   - The owner selects a target tenant from the tenant switcher in the
//     sidebar (only visible to owners).
//   - We store the target tenant id in localStorage so it persists across
//     page refreshes.
//   - On every tRPC request, we read the target id and set the
//     `X-Preview-Tenant` header on the fetch. The backend context.ts reads
//     that header and overrides ctx.tenant.
//
// Side effect: while previewing, `actingAsOwner` is false on the backend.
// Routes can use that to skip destructive ops (e.g. "delete tenant" should
// only work on your own tenant).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "voicereach:preview-tenant-id";

type PreviewState = {
  targetTenantId: number | null;
  setTarget: (id: number | null) => void;
};

const PreviewContext = createContext<PreviewState | null>(null);

export function TenantPreviewProvider({ children }: { children: ReactNode }) {
  const [targetTenantId, setTargetTenantId] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (!v) return null;
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  });

  const setTarget = useCallback((id: number | null) => {
    setTargetTenantId(id);
    try {
      if (id == null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(id));
    } catch {
      // ignore
    }
  }, []);

  // Mirror the current preview id onto a global so the tRPC fetch can read it
  // without re-rendering on every change. The tRPC client closure would
  // otherwise capture a stale value.
  useEffect(() => {
    (globalThis as any).__VOICEREACH_PREVIEW_TENANT__ = targetTenantId;
  }, [targetTenantId]);

  const value = useMemo<PreviewState>(
    () => ({ targetTenantId, setTarget }),
    [targetTenantId, setTarget],
  );

  return (
    <PreviewContext.Provider value={value}>{children}</PreviewContext.Provider>
  );
}

export function useTenantPreview(): PreviewState {
  const ctx = useContext(PreviewContext);
  if (!ctx) {
    throw new Error(
      "useTenantPreview must be used inside <TenantPreviewProvider>",
    );
  }
  return ctx;
}

// Read the current preview tenant id (sync, for fetch closures).
export function getActivePreviewTenantId(): number | null {
  return (globalThis as any).__VOICEREACH_PREVIEW_TENANT__ ?? null;
}
