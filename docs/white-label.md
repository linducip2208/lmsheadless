# White-label

Branding lives in `organizations.settings` (JSON) and is managed centrally:

- Read (public-safe subset): `GET /api/v1/organizations/:id/branding` →
  `app_name, logo_url, favicon_url, primary_color, secondary_color, footer_text, support_email, support_url, locale, timezone` (defaults filled; no private data).
- Write (perm `settings.manage`): `PUT /api/v1/organizations/:id {"name?","description?","settings":{…}}` — keys restricted to `[a-z0-9_]+`, values ≤2000 chars.
- Portals apply branding at boot (`applyBranding`: document title + `--tblr-primary`); admin exposes a branding editor in Organizations and Settings.

Default brand: **LMS Headless** (`#206bc4`). Nothing is hardcoded: login pages,
headers and footers read the same endpoint. Custom domains/subdomains terminate
at the host/CDN layer and map to organization by slug — see `deployment.md`.

## Custom domains

`POST /api/v1/organizations/:id/domain {"hostname"}` validates the hostname
(RFC shape, no localhost) and returns a TXT verification record
(`_lms-verify.<host>`). The domain stays `pending` in settings
(`custom_domain`, `domain_status`, `domain_token` — token never exposed via
the public branding endpoint) until ownership **and** routing are verified:

1. Add the TXT record at your DNS provider.
2. In Cloudflare: add the hostname as a Custom Hostname (SSL for SaaS) or a
   CNAME to your Workers/Pages deployment, per `docs/deployment.md`.
3. Confirm resolution, then flip `domain_status` via the settings API.

Never trust a Host header alone for tenant resolution; the API continues to
scope by authenticated membership, with the domain as a display/routing hint.

