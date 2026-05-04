import "dotenv/config";
import { PrismaClient, RevenueSource, DataSourceStatus } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  const user = await prisma.user.upsert({
    where: { email: "demo@example.com" },
    update: {},
    create: {
      email: "demo@example.com",
      portfolioCurrency: "USD",
    },
  });

  const [appAlpha, appBeta, appGamma] = await Promise.all([
    prisma.app.upsert({
      where: { id: "app-alpha-seed-id-000000000001" },
      update: {},
      create: {
        id: "app-alpha-seed-id-000000000001",
        userId: user.id,
        name: "Alpha SaaS",
        description: "B2B subscription tool",
      },
    }),
    prisma.app.upsert({
      where: { id: "app-beta-seed-id-0000000000002" },
      update: {},
      create: {
        id: "app-beta-seed-id-0000000000002",
        userId: user.id,
        name: "Beta Mobile",
        description: "Consumer iOS app",
      },
    }),
    prisma.app.upsert({
      where: { id: "app-gamma-seed-id-000000000003" },
      update: {},
      create: {
        id: "app-gamma-seed-id-000000000003",
        userId: user.id,
        name: "Gamma Plugin",
        description: "Browser extension with one-time purchases",
      },
    }),
  ]);

  const [stripeSource, revenueCatSource] = await Promise.all([
    prisma.dataSource.upsert({
      where: { userId_source: { userId: user.id, source: RevenueSource.STRIPE } },
      update: {},
      create: {
        userId: user.id,
        source: RevenueSource.STRIPE,
        status: DataSourceStatus.ACTIVE,
        displayName: "Stripe",
        lastSyncedAt: null,
      },
    }),
    prisma.dataSource.upsert({
      where: { userId_source: { userId: user.id, source: RevenueSource.REVENUECAT } },
      update: {},
      create: {
        userId: user.id,
        source: RevenueSource.REVENUECAT,
        status: DataSourceStatus.ACTIVE,
        displayName: "RevenueCat",
        lastSyncedAt: null,
      },
    }),
  ]);

  // Stripe products — two mapped, one unmapped
  await Promise.all([
    prisma.externalProduct.upsert({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId: stripeSource.id,
          externalProductId: "price_alpha_monthly",
        },
      },
      update: {},
      create: {
        dataSourceId: stripeSource.id,
        externalProductId: "price_alpha_monthly",
        displayName: "Alpha SaaS — Monthly",
        appId: appAlpha.id,
      },
    }),
    prisma.externalProduct.upsert({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId: stripeSource.id,
          externalProductId: "price_gamma_lifetime",
        },
      },
      update: {},
      create: {
        dataSourceId: stripeSource.id,
        externalProductId: "price_gamma_lifetime",
        displayName: "Gamma Plugin — Lifetime",
        appId: appGamma.id,
      },
    }),
    // Unmapped — no appId
    prisma.externalProduct.upsert({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId: stripeSource.id,
          externalProductId: "price_unknown_addon",
        },
      },
      update: {},
      create: {
        dataSourceId: stripeSource.id,
        externalProductId: "price_unknown_addon",
        displayName: "Unknown Add-on",
        appId: null,
      },
    }),
  ]);

  // RevenueCat products — one mapped, one unmapped
  await Promise.all([
    prisma.externalProduct.upsert({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId: revenueCatSource.id,
          externalProductId: "beta_pro_monthly",
        },
      },
      update: {},
      create: {
        dataSourceId: revenueCatSource.id,
        externalProductId: "beta_pro_monthly",
        displayName: "Beta Mobile Pro — Monthly",
        appId: appBeta.id,
      },
    }),
    // Unmapped — no appId
    prisma.externalProduct.upsert({
      where: {
        dataSourceId_externalProductId: {
          dataSourceId: revenueCatSource.id,
          externalProductId: "beta_lifetime_old",
        },
      },
      update: {},
      create: {
        dataSourceId: revenueCatSource.id,
        externalProductId: "beta_lifetime_old",
        displayName: "Beta Mobile Lifetime (legacy)",
        appId: null,
      },
    }),
  ]);

  console.log(`Seeded user: ${user.email}`);
  console.log(`Seeded apps: ${appAlpha.name}, ${appBeta.name}, ${appGamma.name}`);
  console.log(`Seeded sources: Stripe, RevenueCat`);
  console.log(`Seeded 5 external products (3 mapped, 2 unmapped)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
