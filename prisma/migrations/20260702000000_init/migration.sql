-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" TEXT,
    "parentalRating" TEXT,
    "genre" TEXT,
    "quality" TEXT,
    "isPremium" BOOLEAN,
    "playbackUrl" TEXT,
    "geoBlockCountriesOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Content_type_check" CHECK ("type" IN ('SERIES', 'SEASON', 'EPISODE', 'MOVIE')),
    CONSTRAINT "Content_quality_check" CHECK ("quality" IS NULL OR "quality" IN ('SD', 'HD', 'UHD_4K')),
    CONSTRAINT "Content_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Content" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ContentGeoBlockCountry" (
    "contentId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    PRIMARY KEY ("contentId", "countryCode"),
    CONSTRAINT "ContentGeoBlockCountry_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LiveChannel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EpgProgram" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "channelId" TEXT NOT NULL,
    "programName" TEXT NOT NULL,
    "startTime" DATETIME NOT NULL,
    "endTime" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EpgProgram_time_range_check" CHECK ("startTime" < "endTime"),
    CONSTRAINT "EpgProgram_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LiveChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EpgScheduleLock" (
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EpgScheduleLock_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LiveChannel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Content_type_idx" ON "Content"("type");

-- CreateIndex
CREATE INDEX "Content_parentId_idx" ON "Content"("parentId");

-- CreateIndex
CREATE INDEX "Content_parentId_type_idx" ON "Content"("parentId", "type");

-- CreateIndex
CREATE INDEX "ContentGeoBlockCountry_countryCode_idx" ON "ContentGeoBlockCountry"("countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "LiveChannel_slug_key" ON "LiveChannel"("slug");

-- CreateIndex
CREATE INDEX "EpgProgram_channelId_startTime_endTime_idx" ON "EpgProgram"("channelId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "EpgProgram_channelId_endTime_idx" ON "EpgProgram"("channelId", "endTime");

-- CreateIndex
CREATE UNIQUE INDEX "EpgProgram_channelId_startTime_endTime_key" ON "EpgProgram"("channelId", "startTime", "endTime");
