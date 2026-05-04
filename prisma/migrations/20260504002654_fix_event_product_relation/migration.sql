/*
  Warnings:

  - You are about to drop the column `externalProductId` on the `normalized_revenue_events` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "normalized_revenue_events" DROP CONSTRAINT "normalized_revenue_events_externalProductId_fkey";

-- AlterTable
ALTER TABLE "normalized_revenue_events" DROP COLUMN "externalProductId",
ADD COLUMN     "sourceProductId" TEXT;
