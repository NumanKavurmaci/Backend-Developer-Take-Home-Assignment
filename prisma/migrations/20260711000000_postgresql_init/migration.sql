-- CreateTable
CREATE TABLE "Content" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "parentId" TEXT,
    "parentalRating" TEXT,
    "genre" TEXT,
    "quality" TEXT,
    "isPremium" BOOLEAN,
    "playbackUrl" TEXT,
    "geoBlockCountriesOverride" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Content_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Content_type_check" CHECK ("type" IN ('SERIES', 'SEASON', 'EPISODE', 'MOVIE')),
    CONSTRAINT "Content_quality_check" CHECK ("quality" IS NULL OR "quality" IN ('SD', 'HD', 'UHD_4K'))
);

-- CreateTable
CREATE TABLE "ContentGeoBlockCountry" (
    "contentId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,

    CONSTRAINT "ContentGeoBlockCountry_pkey" PRIMARY KEY ("contentId", "countryCode")
);

-- CreateTable
CREATE TABLE "LiveChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "LiveChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpgProgram" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "programName" TEXT NOT NULL,
    "startTime" TIMESTAMPTZ(3) NOT NULL,
    "endTime" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EpgProgram_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "EpgProgram_time_range_check" CHECK ("startTime" < "endTime")
);

-- CreateTable
CREATE TABLE "EpgScheduleLock" (
    "channelId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "EpgScheduleLock_pkey" PRIMARY KEY ("channelId")
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
CREATE UNIQUE INDEX "EpgProgram_channelId_startTime_endTime_key" ON "EpgProgram"("channelId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "EpgProgram_channelId_startTime_endTime_idx" ON "EpgProgram"("channelId", "startTime", "endTime");

-- CreateIndex
CREATE INDEX "EpgProgram_channelId_endTime_idx" ON "EpgProgram"("channelId", "endTime");

-- AddForeignKey
ALTER TABLE "Content" ADD CONSTRAINT "Content_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Content"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentGeoBlockCountry" ADD CONSTRAINT "ContentGeoBlockCountry_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "Content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpgProgram" ADD CONSTRAINT "EpgProgram_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpgScheduleLock" ADD CONSTRAINT "EpgScheduleLock_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "LiveChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

