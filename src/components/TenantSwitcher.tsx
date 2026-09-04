// Owner-only tenant switcher.
//
// Rendered at the top of the sidebar (below the brand/nav header). Lets the
// platform owner pick a tenant to "preview" — the dashboard then shows that
// tenant's data as if they had logged in.
//
// Inactive (hidden) for non-owners. When the owner is previewing, a yellow
// "Previewing" banner with an "Exit" button is shown so they can't forget
// they're not in their own dashboard.

import { useEffect, useState } from "react";
import { trpc } from "@/providers/trpc";
import { useTenantPreview } from "@/providers/TenantPreview";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eye, X, Building2 } from "lucide-react";

type TenantOption = {
  id: number;
  name: string;
  slug: string;
  brandName: string;
  complianceTier: "basic" | "hipaa";
};

export function TenantSwitcher() {
  const { data, isLoading } = trpc.tenants.viewingAs.useQuery();
  const { data: tenants } = trpc.tenants.listForPreview.useQuery(undefined, {
    enabled: !!data?.isOwner,
  });
  const utils = trpc.useUtils();
  const { targetTenantId, setTarget } = useTenantPreview();
  const [open, setOpen] = useState(false);

  // If the target tenant id stored in localStorage isn't in the list (e.g.
  // the tenant was deleted), clear the preview.
  useEffect(() => {
    if (!tenants || targetTenantId == null) return;
    if (!tenants.some((t) => t.id === targetTenantId)) {
      setTarget(null);
    }
  }, [tenants, targetTenantId, setTarget]);

  if (isLoading || !data) return null;
  if (!data.isOwner) return null;

  const options: TenantOption[] = tenants ?? [];

  const onChange = async (val: string) => {
    const id = parseInt(val, 10);
    setTarget(Number.isFinite(id) ? id : null);
    // Refetch tenant-scoped data so the next render shows the new tenant.
    await utils.invalidate();
  };

  const exit = async () => {
    setTarget(null);
    await utils.invalidate();
  };

  return (
    <div className="px-2 py-2 border-b border-border/40 space-y-2">
      <div className="flex items-center gap-2 px-2">
        <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground tracking-wide uppercase">
          Tenant
        </span>
      </div>
      <Select
        value={targetTenantId != null ? String(targetTenantId) : "own"}
        onValueChange={(v) => {
          if (v === "own") {
            void exit();
          } else {
            void onChange(v);
          }
        }}
        open={open}
        onOpenChange={setOpen}
      >
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Select tenant…" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="own">
            <span className="flex items-center gap-2">
              <span className="font-medium">{data.ownTenantId ? "My tenant" : "—"}</span>
              <Badge variant="outline" className="text-[10px]">You</Badge>
            </span>
          </SelectItem>
          {options.map((t) => (
            <SelectItem key={t.id} value={String(t.id)}>
              <span className="flex items-center gap-2">
                <span>{t.brandName}</span>
                {t.complianceTier === "hipaa" && (
                  <Badge variant="outline" className="text-[10px] border-amber-500/60 text-amber-700">
                    HIPAA
                  </Badge>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {data.isPreviewing && data.target && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-300/60 dark:border-amber-700/40 px-2.5 py-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-amber-900 dark:text-amber-200">
            <Eye className="h-3.5 w-3.5" />
            Previewing as <strong>{data.target.brandName}</strong>
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 hover:bg-amber-200/60 dark:hover:bg-amber-900/40"
            onClick={exit}
            title="Exit preview"
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}
    </div>
  );
}
