// Seed the database with the default tenant (Premium Meridian) and the 12
// starter verticals on first boot. This runs on `npm run db:seed`.
//
// Idempotent: re-running is safe (uses ON CONFLICT DO NOTHING).

import { getDb, closeDb } from "../api/queries/connection";
import { tenants, verticals, credentials, users } from "./schema";
import { eq, and } from "drizzle-orm";
import { STARTER_VERTICAL_IDS, AGENT_CATEGORIES } from "../contracts/catalog";

// Helper: find the matching AGENT_CATEGORIES entry for a category id.
function getCategoryConfig(id: string) {
  return AGENT_CATEGORIES.find((c) => c.id === id);
}

async function seed() {
  const db = getDb();

  // 1) Default tenant (Premium Meridian — the existing live customer)
  const tenantName = process.env.DEFAULT_TENANT_NAME ?? "Premium Meridian";
  const tenantSlug = process.env.DEFAULT_TENANT_SLUG ?? "premium-meridian";
  const brandName = process.env.DEFAULT_TENANT_BRAND_NAME ?? "Premium Meridian";
  const brandDomain = process.env.DEFAULT_TENANT_BRAND_DOMAIN ?? "premiummeridian.org";
  const brandPhone = process.env.DEFAULT_TENANT_BRAND_PHONE ?? "+13868438160";
  const brandEmail = process.env.DEFAULT_TENANT_BRAND_EMAIL ?? "management@premiummeridian.org";
  const brandLegalName = process.env.DEFAULT_TENANT_BRAND_LEGAL_NAME ?? "Premium Meridian LLC";
  const complianceTier = (process.env.DEFAULT_TENANT_COMPLIANCE_TIER ?? "hipaa") as "basic" | "hipaa";

  const existingTenant = await db.query.tenants.findFirst({
    where: eq(tenants.slug, tenantSlug),
  });

  let tenantId: number;
  if (existingTenant) {
    tenantId = existingTenant.id;
    console.log(`✓ Tenant exists: ${existingTenant.name} (id=${tenantId})`);
  } else {
    const inserted = await db
      .insert(tenants)
      .values({
        name: tenantName,
        slug: tenantSlug,
        brandName,
        brandDomain,
        brandPhone,
        brandEmail,
        brandLegalName,
        complianceTier,
      })
      .returning({ id: tenants.id });
    tenantId = inserted[0].id;
    console.log(`+ Created tenant: ${tenantName} (id=${tenantId})`);
  }

  // 2) Starter verticals — owned by the platform (owner_tenant_id = NULL)
  // but we also clone the peptide vertical under the Premium Meridian tenant
  // so it's immediately deployable in the dashboard.

  for (const category of STARTER_VERTICAL_IDS) {
    // Platform-level vertical (no owner)
    const platformExisting = await db.query.verticals.findFirst({
      where: (v, { and, eq, isNull }) =>
        and(eq(v.category, category), isNull(v.ownerTenantId)),
    });
    if (!platformExisting) {
      const cfg = getCategoryConfig(category);
      await db.insert(verticals).values({
        ownerTenantId: null,
        category,
        name: cfg?.label ?? category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: cfg?.description ?? `Starter vertical: ${category}`,
        direction: (cfg?.direction ?? "both") as "inbound" | "outbound" | "both",
        visibility: "public",
        defaultComplianceTier:
          (cfg?.defaultComplianceTier ??
            (category === "peptides_wellness" || category === "dental_practice" ? "hipaa" : "basic")) as
            | "basic"
            | "hipaa",
      });
      console.log(`+ Created platform vertical: ${category}`);
    }

    // Tenant-level clone of the peptides vertical (so it's deployable
    // in the PM dashboard from day one).
    if (category === "peptides_wellness") {
      const tenantClone = await db.query.verticals.findFirst({
        where: (v, { and, eq }) =>
          and(eq(v.category, category), eq(v.ownerTenantId, tenantId)),
      });
      if (!tenantClone) {
        await db.insert(verticals).values({
          ownerTenantId: tenantId,
          category,
          name: "Peptides & Wellness (Premium Meridian)",
          description: "Production peptides vertical for Premium Meridian LLC",
          visibility: "private",
          defaultComplianceTier: "hipaa",
        });
        console.log(`+ Created tenant-specific peptides vertical for ${tenantName}`);
      }
    }
  }

  // 3) Default credentials for Premium Meridian (the canonical live tenant)
  //    - Twilio creds: the Premium Meridian account
  //    - FastAPI bridge: the AI Caller backend on Render
  //    - These can be overridden in the dashboard's Settings page
  const existingCreds = await db.query.credentials.findFirst({
    where: eq(credentials.tenantId, tenantId),
  });
  if (!existingCreds) {
    const twilioSid = process.env.PREMIUM_MERIDIAN_TWILIO_SID;
    const twilioAuth = process.env.PREMIUM_MERIDIAN_TWILIO_AUTH;
    const twilioPhone = process.env.PREMIUM_MERIDIAN_TWILIO_PHONE;
    const fastApiUrl = process.env.PREMIUM_MERIDIAN_FASTAPI_URL;
    const fastApiKey = process.env.PREMIUM_MERIDIAN_FASTAPI_KEY;

    await db.insert(credentials).values({
      tenantId,
      twilioAccountSid: twilioSid ?? null,
      twilioAuthToken: twilioAuth ?? null,
      twilioPhoneNumber: twilioPhone ?? null,
      fastApiUrl: fastApiUrl ?? "https://ai-caller-api-82u7.onrender.com",
      fastApiAdminKey: fastApiKey ?? null,
    });
    if (fastApiUrl) {
      console.log(`+ Created credentials for ${tenantName} (FastAPI bridge: ${fastApiUrl})`);
    } else {
      console.log(`+ Created empty credentials for ${tenantName} (set PREMIUM_MERIDIAN_FASTAPI_KEY env to wire the bridge)`);
    }
  } else {
    console.log(`✓ Credentials exist for ${tenantName}`);
  }

  console.log("Seed complete.");
  await closeDb();
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
