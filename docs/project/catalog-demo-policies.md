# Minimal Catalog Demo Policies

TVmaze source facts remain unchanged. SaatCMS adds only a small deterministic
policy layer needed to demonstrate the assignment's existing inheritance and
authorization behavior.

Every Series owns these defaults:

- parental rating `13+`;
- policy genre `General`;
- quality `HD`;
- non-premium playback;
- placeholder `https://media.invalid/content/{contentId}`;
- explicit geo blocks for `IR` and `SY`.

Rows are selected by stable Content ID, never provider response order or build
time. The first qualifying hierarchy needs two Seasons: one with an Episode and
another with two Episodes. The second Season overrides parental rating and
policy genre. Its second Episode overrides quality and premium status to
premium 4K, owns its `.invalid` placeholder, and explicitly clears inherited
geo blocks. These three Episodes cover every scenario without generating extra
commercial-policy variations.

The artifact scenario IDs identify inherited metadata, Season override, Episode
override, geo rejection, empty geo override, allowed playback, and premium 4K
Mobile rejection. Several scenarios intentionally share the same Content ID.

The placeholder is data, not a stream. Validation permits only HTTPS URLs on
the exact `media.invalid` host without credentials, query parameters, or
fragments. Generation, verification, and playback tests never fetch it. Real
streams, playlists, signed URLs, credentials, DRM, hosting, and availability
checks remain out of scope.
