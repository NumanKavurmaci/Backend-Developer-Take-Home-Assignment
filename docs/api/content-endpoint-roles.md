# Content Endpoint Roles

The content APIs expose different representations of the same underlying
content records. They are separate contracts for separate callers, not aliases.

| Endpoint | Intended caller | Authentication | Representation | Protected playback URL |
| --- | --- | --- | --- | --- |
| `GET /api/v1/cms/content/{id}` | CMS operator or administration tool | CMS bearer credential | Raw editable record, including nullable inheritance controls, parent ID, timestamps, and ETag | Included for authorized CMS readers |
| `GET /api/v1/mw/content/{contentId}` | Browse, detail, or metadata client | None | Public metadata dynamically resolved through the content hierarchy | Never included |
| `GET /api/v1/mw/playback/{contentId}` | Client starting playback | Playback request headers | Authorized playback result plus resolved metadata | Included only after geo and device checks pass |

## Contract Boundaries

- CMS content reads expose stored values so operators can distinguish an
  explicit value from `null`, which restores inheritance.
- Middleware content reads expose the effective value after applying the
  Episode -> Season -> Series inheritance rules.
- Playback reads repeat the effective public metadata for the authorized
  playback decision, but keep the protected URL in the `playback` object.
- The middleware services share the internal inheritance engine. Neither
  middleware endpoint makes an HTTP request to the other endpoint.

Removing or merging an endpoint therefore requires a client migration and an
explicit API deprecation process; matching content identifiers do not make the
response contracts interchangeable.
