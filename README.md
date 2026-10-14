# Gut Smart Live

Source for gutsmartlive.com: a resource on fermented, probiotic-rich foods and visceral fat.

- `pages/` page content, assembled into `public/` by `scripts/build.mjs` with `partials/`
- `public/` static site served by Cloudflare (CSS, JS and built pages)
- `src/` Cloudflare Worker: API, moderation, daily PubMed pull, weekly digest
- `migrations/` D1 database schema

## Commands

- `npm run dev` build and run locally
- `npm test` unit and end-to-end tests
- `npm run deploy` build and deploy to Cloudflare

## Scheduled jobs

- Daily 10:15 UTC: pull new studies from PubMed into the research log
- Mondays 13:00 UTC: weekly digest email to subscribers (once a Resend API key is saved in the settings table)

## Moderation

Stories and comments are held as pending until approved at /admin.
