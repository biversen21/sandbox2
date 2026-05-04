-- CreateEnum
CREATE TYPE "RevenueSource" AS ENUM ('STRIPE', 'REVENUECAT');

-- CreateEnum
CREATE TYPE "DataSourceStatus" AS ENUM ('ACTIVE', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "RevenueEventType" AS ENUM ('SUBSCRIPTION_NEW', 'SUBSCRIPTION_RENEWAL', 'ONE_TIME_PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "AppClassification" AS ENUM ('INSUFFICIENT_DATA', 'AT_RISK', 'DECLINING', 'SLIPPING', 'STABLE', 'GROWING', 'RECOVERING');

-- CreateEnum
CREATE TYPE "RecommendationType" AS ENUM ('OPPORTUNITY', 'RISK');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "portfolioCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apps" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "RevenueSource" NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'ACTIVE',
    "displayName" TEXT NOT NULL,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_products" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "externalProductId" TEXT NOT NULL,
    "displayName" TEXT,
    "appId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "external_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "normalized_revenue_events" (
    "id" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" "RevenueSource" NOT NULL,
    "sourceEventId" TEXT NOT NULL,
    "eventType" "RevenueEventType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "isPortfolioCurrency" BOOLEAN NOT NULL,
    "externalProductId" TEXT,
    "externalCustomerId" TEXT,
    "appId" TEXT,
    "rawPayload" JSONB,

    CONSTRAINT "normalized_revenue_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_app_revenue" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "grossRevenue" INTEGER NOT NULL DEFAULT 0,
    "refunds" INTEGER NOT NULL DEFAULT 0,
    "netRevenue" INTEGER NOT NULL DEFAULT 0,
    "newSubscriptionRevenue" INTEGER NOT NULL DEFAULT 0,
    "renewalRevenue" INTEGER NOT NULL DEFAULT 0,
    "oneTimeRevenue" INTEGER NOT NULL DEFAULT 0,
    "excludedCurrencyEventCount" INTEGER NOT NULL DEFAULT 0,
    "excludedCurrencyGross" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_app_revenue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portfolio_insights" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "topRecommendationAppId" TEXT,
    "topRecommendationType" "RecommendationType",
    "total7dNetRevenue" INTEGER NOT NULL DEFAULT 0,
    "total28dNetRevenue" INTEGER NOT NULL DEFAULT 0,
    "unmappedRevenue7d" INTEGER NOT NULL DEFAULT 0,
    "hasUnmappedRevenue" BOOLEAN NOT NULL DEFAULT false,
    "hasCurrencyWarning" BOOLEAN NOT NULL DEFAULT false,
    "currencyWarningDetail" TEXT,

    CONSTRAINT "portfolio_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_insights" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "portfolioInsightId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "classification" "AppClassification" NOT NULL,
    "opportunityScore" DOUBLE PRECISION,
    "riskScore" DOUBLE PRECISION,
    "isTopRecommendation" BOOLEAN NOT NULL DEFAULT false,
    "recommendationType" "RecommendationType",
    "isRefundDriven" BOOLEAN NOT NULL DEFAULT false,
    "observation" TEXT NOT NULL,
    "interpretation" TEXT NOT NULL,
    "recommendation" TEXT NOT NULL,

    CONSTRAINT "app_insights_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "apps_userId_idx" ON "apps"("userId");

-- CreateIndex
CREATE INDEX "data_sources_userId_idx" ON "data_sources"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "data_sources_userId_source_key" ON "data_sources"("userId", "source");

-- CreateIndex
CREATE INDEX "external_products_appId_idx" ON "external_products"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "external_products_dataSourceId_externalProductId_key" ON "external_products"("dataSourceId", "externalProductId");

-- CreateIndex
CREATE UNIQUE INDEX "normalized_revenue_events_idempotencyKey_key" ON "normalized_revenue_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "normalized_revenue_events_userId_source_occurredAt_idx" ON "normalized_revenue_events"("userId", "source", "occurredAt");

-- CreateIndex
CREATE INDEX "normalized_revenue_events_appId_occurredAt_idx" ON "normalized_revenue_events"("appId", "occurredAt");

-- CreateIndex
CREATE INDEX "daily_app_revenue_appId_date_idx" ON "daily_app_revenue"("appId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_app_revenue_appId_date_key" ON "daily_app_revenue"("appId", "date");

-- CreateIndex
CREATE INDEX "portfolio_insights_userId_generatedAt_idx" ON "portfolio_insights"("userId", "generatedAt");

-- CreateIndex
CREATE INDEX "app_insights_appId_generatedAt_idx" ON "app_insights"("appId", "generatedAt");

-- CreateIndex
CREATE INDEX "app_insights_portfolioInsightId_idx" ON "app_insights"("portfolioInsightId");

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_products" ADD CONSTRAINT "external_products_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "data_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_products" ADD CONSTRAINT "external_products_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalized_revenue_events" ADD CONSTRAINT "normalized_revenue_events_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "normalized_revenue_events" ADD CONSTRAINT "normalized_revenue_events_externalProductId_fkey" FOREIGN KEY ("externalProductId") REFERENCES "external_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_app_revenue" ADD CONSTRAINT "daily_app_revenue_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portfolio_insights" ADD CONSTRAINT "portfolio_insights_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_insights" ADD CONSTRAINT "app_insights_appId_fkey" FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_insights" ADD CONSTRAINT "app_insights_portfolioInsightId_fkey" FOREIGN KEY ("portfolioInsightId") REFERENCES "portfolio_insights"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
