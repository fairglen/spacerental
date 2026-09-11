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

The contact form POSTs to whatever `APPS_SCRIPT_URL` is set to in
`assets/js/contact-form.js`. Until a real Apps Script Web App is deployed
(see below), that URL is the placeholder `PASTE_DEPLOYED_URL_HERE`, and the
form **disables itself on load**: the submit button is greyed out, an error
banner tells the visitor the form is temporarily unavailable, and a
`console.error` points back at this runbook. This is expected before deploy.

That guard is not cosmetic. The placeholder is a *relative* URL, and a 404
still **fulfills** `fetch()` — only network-level failures reject it — while
`mode: 'no-cors'` makes the response opaque. Without the guard the success
path ran and the visitor was told "Mensagem enviada!" while nothing had been
sent. `contact-form.js` therefore refuses to call `fetch()` unless
`APPS_SCRIPT_URL` is an absolute `https://script.google.com/...` URL, and an
unconfigured URL can never render a success banner. `tests/smoke.spec.ts`
pins that behavior.

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
- Rate limiting instead uses `CacheService`/`PropertiesService` — see "Rate
  limiting and the global cap" below.
- If durable logging is ever needed (e.g. for follow-up or analytics), that
  is tracked as a future follow-up, not something half-built here — do not
  add commented-out `SpreadsheetApp` code "just in case."

## Rate limiting and the global cap

`checkAndReserveSendSlot()` in `Code.gs` enforces two layers, both under a
`LockService` script lock (an unlocked check-then-set lets two concurrent
executions both see an empty cache and both send):

1. **Per-email cooldown** — `CacheService.getScriptCache()` with a 5-minute
   TTL, keyed on a SHA-256 hash of the sanitized email. The hash is not for
   privacy; it bounds the key length, because a 254-character address plus
   the key prefix exceeds `CacheService`'s 250-character limit and would
   throw *before* the mail was sent. This layer is deliberately best-effort
   and per-script: it does not survive a runtime restart or a redeploy, the
   same caveat pixelforge documents for its own limiter.
2. **Global cap** — **15 sends/hour** and **50 sends/day**, counted across
   all submitters and keyed on nothing the submitter controls.

Layer 2 exists because layer 1 keys on attacker-supplied data: a bot cycling
unique, valid-looking addresses walks straight past a per-email limit. Apps
Script does not expose the requester's IP, so an IP-based limit is not
available to us. Both counters are fixed windows (calendar hour, UTC day)
rather than true rolling ones — at a window boundary that lets at most one
extra window through, comfortably inside the margin these caps leave against
the mail quota.

**This is a deliberate tradeoff, and it is honestly a blunt one.** A genuine
burst of traffic — a newsletter mention, a conference, a busy launch day —
can trip the cap and turn real enquiries away with `rate_limited`. That is
the failure we chose. The alternative is a bot exhausting the ~100/day
`MailApp` quota, which silently kills *all* lead delivery for the rest of the
day, with no signal to anyone. Turning some leads away loudly beats losing
every lead quietly. Raise `GLOBAL_HOURLY_LIMIT`/`GLOBAL_DAILY_LIMIT` in
`CONFIG` if real traffic justifies it (and the account's quota allows it).

**A CAPTCHA is the real long-term fix.** If spam — rather than genuine
traffic — is what keeps tripping the cap, raising the numbers just hands the
quota back to the bot. reCAPTCHA v3 (which the pixelforge reference documents
as its own recommended next layer) is the right answer at that point: it
distinguishes bots from humans instead of rationing everyone equally.

## Mail quota

`MailApp.sendEmail` is subject to Google's daily quota. A consumer Google
account (a plain `@gmail.com`-style account) is capped at roughly **100
sends/day**. A Google Workspace account has a much higher cap. For a
low-traffic contact form this is unlikely to matter, but if `Code.gs` starts
returning `send_failed`, check the quota first
(Apps Script editor → Executions, or the account's Workspace admin console).

## Manual verification checklist

Run this before the first deploy, and again after any content/JS change. The
optional Playwright smoke test below covers a slice of it automatically, but
this checklist is the actual gate — it is the only thing that covers
`Code.gs`, which cannot run locally at all.

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

**Contact form — unconfigured endpoint guard** (check this *before* pasting
the deployed URL in, and again any time `APPS_SCRIPT_URL` changes)
- [ ] With `APPS_SCRIPT_URL` still `PASTE_DEPLOYED_URL_HERE`, the page loads
      with the submit button **disabled** and the error banner visible
      reading "O formulário está temporariamente indisponível…".
- [ ] The browser console shows the `APPS_SCRIPT_URL is not configured` error
      pointing at this runbook.
- [ ] Forcing a submit anyway (devtools:
      `document.getElementById('contactForm').dispatchEvent(new Event('submit', {cancelable: true}))`)
      fires **no** network request and shows **no** success banner. This is
      the regression that matters most — a false "Mensagem enviada!" loses
      the enquiry silently.
- [ ] Same checks with a *malformed* URL (e.g. `http://example.com/exec`, or
      an https URL not on `script.google.com`) — also refused.

**Contact form — normal operation**
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

**Accessibility**
- [ ] Each invalid control gets `aria-invalid="true"` after a failed submit,
      and clears back to `"false"` once corrected (inspect `#nome`, `#email`,
      `#especialidade`, `#interesse`).
- [ ] Each control's `aria-describedby` points at its `*-error` paragraph, so
      a screen reader reads the field-specific message.
- [ ] The mobile menu button's `aria-label` tracks its action ("Abrir menu"
      closed / "Fechar menu" open) alongside `aria-expanded`, and its
      `aria-controls` points at `navMobile`.

**Apps Script global cap** (after deploy, optional — it consumes quota)
- [ ] Submitting more than `GLOBAL_HOURLY_LIMIT` (15) messages from
      *different* email addresses within one hour returns `rate_limited` and
      sends no further mail. The per-email cooldown alone does **not** catch
      this — the global cap is what does, and it is the whole point of it.
- [ ] The cap resets on the next calendar hour.

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
asserts:

- the hero copy renders, and the Google Maps link href is exactly correct;
- submitting a **configured** form shows the success banner without any real
  network request. Because the committed `APPS_SCRIPT_URL` is the
  placeholder, the spec rewrites that constant in the served script via
  `page.route()` and stubs the endpoint — rather than adding a test-only
  override hook to the production file;
- the **unconfigured** placeholder disables the submit button, shows the
  unavailable banner, and produces neither a request nor a success banner;
- field errors set `aria-invalid` on their controls and clear it once fixed;
- the menu toggle's `aria-label`/`aria-expanded`/`aria-controls` behave.

`apps-script/Code.gs` is **not** covered here — it needs a real Apps Script
runtime and a Google account authorized to send as `geral@flowspace.pt`, so
it cannot run locally. Verify it via the checklist above after deploying.

## Testing

No pytest/Vitest suite applies here — there's no Python and no framework
components, just static HTML/CSS/JS. The manual checklist above is the
actual verification gate, proportionate to what this deliverable is.
