-- Add nullable provider-owned catalog facts directly to Content. Existing demo
-- rows remain valid with NULL source facts and an empty genres array.
ALTER TABLE "Content"
ADD COLUMN "source" TEXT,
ADD COLUMN "sourceId" TEXT,
ADD COLUMN "sourceUrl" TEXT,
ADD COLUMN "originalTitle" TEXT,
ADD COLUMN "summary" TEXT,
ADD COLUMN "language" TEXT,
ADD COLUMN "status" TEXT,
ADD COLUMN "countryCode" TEXT,
ADD COLUMN "networkName" TEXT,
ADD COLUMN "officialSiteUrl" TEXT,
ADD COLUMN "imageUrl" TEXT,
ADD COLUMN "premieredAt" DATE,
ADD COLUMN "endedAt" DATE,
ADD COLUMN "runtimeMinutes" INTEGER,
ADD COLUMN "seasonNumber" INTEGER,
ADD COLUMN "episodeNumber" INTEGER,
ADD COLUMN "ratingAverage" DOUBLE PRECISION,
ADD COLUMN "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "sourceMetadata" JSONB;

-- PostgreSQL permits multiple rows where either unique-key component is NULL.
-- This index also supports source and exact source/sourceId lookups.
CREATE UNIQUE INDEX "Content_source_sourceId_key"
ON "Content"("source", "sourceId");
