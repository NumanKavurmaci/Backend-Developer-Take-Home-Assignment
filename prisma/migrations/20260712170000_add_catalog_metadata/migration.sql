-- CreateTable
CREATE TABLE "CatalogMetadata" (
    "contentId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "originalTitle" TEXT,
    "summary" TEXT,
    "language" TEXT,
    "status" TEXT,
    "countryCode" TEXT,
    "networkName" TEXT,
    "officialSiteUrl" TEXT,
    "imageUrl" TEXT,
    "premieredAt" DATE,
    "endedAt" DATE,
    "runtimeMinutes" INTEGER,
    "seasonNumber" INTEGER,
    "episodeNumber" INTEGER,
    "ratingAverage" DOUBLE PRECISION,
    "genres" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "sourceMetadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "CatalogMetadata_pkey" PRIMARY KEY ("contentId")
);

-- CreateTable
CREATE TABLE "CatalogSeedManifest" (
    "id" TEXT NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sources" JSONB NOT NULL,
    "configuration" JSONB NOT NULL,
    "counts" JSONB NOT NULL,
    "normalizedBytes" BIGINT NOT NULL,
    "estimatedDatabaseBytes" BIGINT NOT NULL,

    CONSTRAINT "CatalogSeedManifest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CatalogMetadata_source_sourceId_key" ON "CatalogMetadata"("source", "sourceId");

-- CreateIndex
CREATE INDEX "CatalogMetadata_source_idx" ON "CatalogMetadata"("source");

-- CreateIndex
CREATE INDEX "CatalogMetadata_premieredAt_idx" ON "CatalogMetadata"("premieredAt");

-- CreateIndex
CREATE INDEX "CatalogMetadata_seasonNumber_episodeNumber_idx" ON "CatalogMetadata"("seasonNumber", "episodeNumber");

-- AddForeignKey
ALTER TABLE "CatalogMetadata"
ADD CONSTRAINT "CatalogMetadata_contentId_fkey"
FOREIGN KEY ("contentId") REFERENCES "Content"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
