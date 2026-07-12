-- Required for GiST equality support on the scalar channel identifier.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Treat schedules as half-open intervals so adjacent programs remain valid.
ALTER TABLE "EpgProgram"
ADD CONSTRAINT "EpgProgram_no_overlap_excl"
EXCLUDE USING gist (
    "channelId" WITH =,
    tstzrange("startTime", "endTime", '[)') WITH &&
);
