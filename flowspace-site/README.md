# flowspace-site

A real, standalone static marketing site for **flowspace.pt** — a Portuguese
therapy-room-rental business. This is **not** part of the EspaçoHora SaaS app
in `frontend/`/`backend/`. It shares no build, no dependency, and no runtime
with that app; it just happens to live in the same repository and is styled
to match its sage-green design system (see `assets/css/tokens.css`, copied
1:1 from `frontend/tailwind.config.ts`).

See `TODO.md`'s "Non-roadmap deliverable" section (F01) for the tracked scope
and acceptance criteria, and the plan this was built from for full context.

## What this is / isn't

- **Is**: a one-page static site (`index.html`) plus a minimal privacy
  placeholder (`privacidade.html`), hand-written CSS, a small vanilla-JS
  contact form, and a Google Apps Script backend that emails submissions to
  `geral@flowspace.pt`.
- **Isn't**: a Next.js app, a Tailwind build, or anything requiring
  `npm install` to preview. It isn't wired into any EspaçoHora CI workflow,
  and touching it never runs `backend-tests.yml`/`frontend-tests.yml`/`e2e.yml`.
- **Isn't** storing submissions anywhere durable — see "Sheet logging" below.

## Local preview

No build step, no dependencies. From the repo root:

```bash
cd flowspace-site
python3 -m http.server 8080
```

Then open `http://localhost:8080/`. Any static file server works equally
well (`npx serve`, VS Code's Live Server, etc.) — Python's is just always
available.

The contact form will attempt to POST to whatever `APPS_SCRIPT_URL` is set to
in `assets/js/contact-form.js`. Until a real Apps Script Web App is deployed
(see below), that URL is the placeholder `PASTE_DEPLOYED_URL_HERE` and
submissions will fail with a network error — this is expected before deploy.

## Apps Script deploy runbook

The contact form's backend (`apps-script/Code.gs`) has to be deployed
manually by whoever has access to a Google account authorized to send email
as `geral@flowspace.pt`. This cannot be scripted or automated by an agent
without that account's credentials — it is a one-time, human, in-browser step.

1. Go to [script.google.com](https://script.google.com) and create a new
   project (e.g. name it "FlowSpace contact form").
2. Delete the default `Code.gs` boilerplate and paste in the full contents of
   this repo's `apps-script/Code.gs`.
3. Click **Deploy → New deployment**.
   - Type: **Web app**.
   - Execute as: **Me** (the Google account that will authorize `MailApp`).
   - Who has access: **Anyone**.
4. Click **Deploy**. The first deploy will prompt an OAuth consent screen —
   review and authorize the requested `MailApp` (send email) scope.
5. Copy the resulting **Web app URL** (ends in `/exec`).
6. Paste that URL into `assets/js/contact-form.js`, replacing
   `PASTE_DEPLOYED_URL_HERE`:
   ```js
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXX/exec';
   ```
7. Commit that change (a public client file referencing a public "Anyone"
   Web App URL is the expected, accepted model here — see the code comment
   for why; pixelforge, the reference implementation, does the same).
8. Send one real test submission through the deployed site and confirm the
   email arrives at `geral@flowspace.pt` with all fields populated.

**Redeploying after editing `Code.gs`:** a plain "Deploy" from the editor
does **not** update the live Web App URL's behavior. You must go to
**Deploy → Manage deployments → (pencil icon) Edit → Version: New version →
Deploy**. This keeps the same `/exec` URL while pushing the new script logic
live.

## Sheet logging is intentionally not implemented

The reference implementation this was adapted from (pixelforge's
`google-apps-script.js`) logs every submission to a Google Sheet and uses
that Sheet to rate-limit repeat submissions per email. This project does
**not** do that:

- There is no `SpreadsheetApp` call anywhere in `Code.gs`.
- Rate limiting instead uses `CacheService.getScriptCache()` keyed on the
  sanitized email, with a 5-minute TTL — see the comment above the rate-limit
  block in `Code.gs`. This is deliberately **best-effort and per-script
  only**: it does not survive an Apps Script runtime restart or a redeploy,
  and it is not a durable, auditable log of who submitted what. It is an
  honest equivalent of pixelforge's own documented rate-limit caveat, just
  without the Sheet dependency.
- If durable logging is ever needed (e.g. for follow-up or analytics), that
  is tracked as a future follow-up, not something half-built here — do not
  add commented-out `SpreadsheetApp` code "just in case."

## Mail quota

`MailApp.sendEmail` is subject to Google's daily quota. A consumer Google
account (a plain `@gmail.com`-style account) is capped at roughly **100
sends/day**. A Google Workspace account has a much higher cap. For a
low-traffic contact form this is unlikely to matter, but if `Code.gs` starts
returning `send_failed`, check the quota first
(Apps Script editor → Executions, or the account's Workspace admin console).

## Manual verification checklist

Run this before the first deploy, and again after any content/JS change.
There is no automated test suite for this site (see "Testing" below for why)
— this checklist is the actual gate.

**Content and navigation**
- [ ] Every section's content matches `index.html` verbatim against the spec
      (hero headline/subheading, "O espaço" paragraph, the three room cards'
      names/prices/descriptions/amenities, the four "Como funciona" steps,
      the three pricing cards, the address, and the footer copyright line).
- [ ] Nav anchors (`#espaco`, `#salas`, `#como-funciona`, `#precos`,
      `#localizacao`, `#contacto`) all scroll to the correct section.
- [ ] Footer links (O espaço, Salas, Preços, Contacto, Política de
      Privacidade) all work, including the link to `privacidade.html`.
- [ ] "Abrir no Google Maps" opens
      `https://www.google.com/maps/search/?api=1&query=Rua+12+de+Julho+de+1997%2C+2745-841+Queluz+%E2%80%94+Massam%C3%A3`
      in a new tab and resolves to the correct address.

**Contact form**
- [ ] Submitting with each required field empty (nome, email, especialidade,
      interesse) in turn shows that field's inline error and does not submit.
- [ ] An invalid email (e.g. `foo@bar`) is rejected client-side.
- [ ] Filling the hidden honeypot field via devtools (`document.getElementById('assunto2').value = 'x'`)
      and submitting results in a silent no-op — no network request fires,
      no banner shows.
- [ ] Submitting twice in rapid succession shows the cooldown message on the
      second attempt.
- [ ] One real submission (after the Apps Script is deployed) arrives at
      `geral@flowspace.pt` with all fields populated correctly.

**Responsive**
- [ ] Layout checked at 375px, 768px, and 1280px viewport widths — no
      horizontal scroll, nav collapses to the mobile menu below 768px.

**Visual parity**
- [ ] Side-by-side against the EspaçoHora SaaS landing page
      (`frontend/app/page.tsx`) for palette, border radius, and font parity.

## Optional smoke test

`tests/smoke.spec.ts` is a standalone Playwright spec with its own tiny
`tests/package.json` and `tests/playwright.config.ts` — **not** registered in
`frontend/playwright.config.ts`, not part of any npm workspace, and not run
by any CI workflow. It's a manual pre-ship check only:

```bash
cd flowspace-site/tests
npm install
npx playwright install chromium
npx playwright test
```

The config's `webServer` starts `python3 -m http.server` against
`flowspace-site/` automatically, so no separate preview server is needed. It
asserts the hero copy renders, the Google Maps link href is exactly correct,
and submitting the form (with the Apps Script call intercepted via
`page.route()`) shows the success banner without any real network request.

## Testing

No pytest/Vitest suite applies here — there's no Python and no framework
components, just static HTML/CSS/JS. The manual checklist above is the
actual verification gate, proportionate to what this deliverable is.
