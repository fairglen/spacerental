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
`console.error` points back at this runbook. This is expected before deploy —
and the Pages workflow refuses to publish while it is the case, see
"Deploying to GitHub Pages" below.

That guard is not cosmetic. The placeholder is a *relative* URL, and a 404
still **fulfills** `fetch()` — only network-level failures reject it. Without
the guard the success path ran and the visitor was told "Mensagem enviada!"
while nothing had been sent. `contact-form.js` therefore refuses to call
`fetch()` unless `APPS_SCRIPT_URL` matches the deployed Web App shape exactly:

```
https://script.google.com/macros/s/<deployment-id>/exec
```

Checking only the origin is **not** enough — `https://script.google.com/`, a
`/dev` URL, or any typo'd path on that host would pass an origin-only check,
reach `fetch()`, and come back as an HTML error page. Anything that does not
match the full pattern above is treated as unconfigured and fails loudly at
load. `tests/smoke.spec.ts` pins that for the placeholder and for four
same-host-but-malformed URLs.

## Deploying to GitHub Pages

`.github/workflows/deploy-flowspace-site.yml` publishes this directory to
GitHub Pages on every push to `main` that touches `flowspace-site/**` (or the
workflow itself), and on manual `workflow_dispatch`.

**Only an explicit allowlist of files is published.** The workflow stages
`index.html`, `privacidade.html`, `assets/**` and a short list of optional
root files (`favicon.*`, `robots.txt`, `sitemap.xml`, `CNAME`, `.nojekyll`, …)
into a clean directory and uploads *that*. It previously uploaded
`flowspace-site/` wholesale, which also served `README.md`, `apps-script/Code.gs`
and `tests/**` at public URLs — and `Code.gs` hands out the honeypot field name
and the exact rate-limit thresholds, which is precisely what a spammer needs to
evade them.

It is an allowlist rather than a denylist on purpose: a denylist silently leaks
whatever file someone adds next. **If you add a file that belongs on the public
site, add it to `SITE_PATHS`/`OPTIONAL_PATHS` in that workflow** — otherwise it
simply will not be published. Each run logs both what it published and what it
skipped, so an omission is visible in the Actions log.

### ⚠️ The deploy fails on purpose until the Apps Script URL is committed

The workflow refuses to publish a site whose contact form is dead on arrival.
Before uploading anything it checks `APPS_SCRIPT_URL` in
`assets/js/contact-form.js` and **fails the job** if it is still
`PASTE_DEPLOYED_URL_HERE`, or if it does not match
`https://script.google.com/macros/s/<deployment-id>/exec` exactly (the same
pattern `contact-form.js` enforces at runtime).

**This means the deploy workflow is red today, and will stay red until someone
completes the Apps Script runbook below and commits the real `/exec` URL.**
That is the intended behaviour, not a bug to route around. Without the gate the
site would publish happily with a permanently disabled contact form: it fails
safe, but silently, and nobody would notice that every enquiry route was shut.
The failure message in the Actions log names the file and the exact fix.

The workflow also runs `actions/configure-pages`, which supplies the
base path and origin that `upload-pages-artifact` and `deploy-pages` expect —
without it a first-time Pages setup can fail at the deploy step.

**Unverified:** no real Pages run has been observed for this workflow. The two
`run` steps (the URL gate and the staging allowlist) were executed locally
against this checkout — the gate fails on the committed placeholder, passes on
a valid `/exec` URL, and rejects a `/dev` URL; the staging step produced exactly
the six site files and excluded `README.md`, `apps-script/` and `tests/`. The
Pages actions themselves (`configure-pages`, `upload-pages-artifact`,
`deploy-pages`) have not run.

## How the form knows a submission actually landed

**A success banner is shown only on positive confirmation** — the response was
read, parsed as JSON, and said `result === 'success'`. Never because
`fetch()` failed to throw. This is the property the whole design hangs on, and
it is worth understanding before changing anything in `contact-form.js`.

The form originally posted with `mode: 'no-cors'` (inherited from the
pixelforge reference). That makes the response **opaque**: no readable status,
no readable body. Every server-side rejection — rate limited, mail quota
exhausted, a DevTools-tampered dropdown value, a malformed body — was
therefore indistinguishable from a delivered message, and the visitor was
shown "Mensagem enviada!" while the enquiry was dropped. Four separate review
findings were all symptoms of that single choice.

The fix is to make the request a CORS **"simple request"**, which needs no
preflight (Apps Script cannot answer an `OPTIONS` preflight):

- `method: 'POST'`, no `mode: 'no-cors'`;
- `Content-Type: text/plain;charset=utf-8` — a safelisted header value.
  `application/json` is *not* safelisted and would trigger a preflight;
- the body is still a JSON string. `Code.gs` reads `e.postData.contents` and
  `JSON.parse`s it regardless of the declared content type, so the server
  needs no change to accept it.

A Web App deployed with **access "Anyone"** answers such a request with a
readable, CORS-permitted response (the `/exec` URL 302s to
`script.googleusercontent.com`, and `fetch` follows that redirect
transparently). **This is why the "Who has access: Anyone" step in the runbook
below is load-bearing, not just convenience** — any other access setting means
the browser blocks the read.

The client then branches three ways:

| Outcome | When | What the visitor sees |
|---|---|---|
| Success | body parsed, `result === 'success'` | success banner; form cleared |
| Error | body parsed, `result === 'error'` | the specific Portuguese message for that error code; entered values kept |
| **Unconfirmed** | `fetch()` threw, body unreadable, or an unrecognised shape | a neutral "we could not confirm the send, try again shortly" message |

The unconfirmed branch is deliberately neutral rather than a hard "failed". A
false failure on a message that *did* send pushes the visitor into submitting a
duplicate, so the copy overclaims in neither direction. It is also the branch a
misconfigured deployment lands in — degrading safely to "we don't know" instead
of a false success.

Each error code `Code.gs` can return has its own message in `ERROR_MESSAGES`
(`rate_limited`, `invalid_email`, `invalid_option`, `missing_fields`,
`send_failed`, `invalid_payload`, `field_too_long`,
`stale_or_future_timestamp`). **If you add an error code to `Code.gs`, add its
message there too** — an unmapped code degrades to the neutral message, which
is safe but unhelpful.

The two enum allowlists (`ALLOWED_ESPECIALIDADE`, `ALLOWED_INTERESSE`) are
mirrored client-side, defined once at the top of `contact-form.js`, so a
tampered `<select>` gets immediate feedback instead of burning a send slot.
That mirror is **feedback only** — `Code.gs` re-checks every value and is the
real enforcement. Never remove the server-side check.

### The request has a deadline

`fetch()` has no timeout of its own, and a connection that opens and then
stalls never settles the promise. Without a deadline the submit button sat on
"A enviar…", disabled, indefinitely — no message, no retry, and no way for the
visitor to tell that anything had gone wrong.

`REQUEST_TIMEOUT_MS` (15s) drives an `AbortController` that covers **both** the
connection and the body read — aborting also rejects an in-flight
`response.text()`, which is the case a connect-only timeout misses (headers
arrive, body never does). A trip routes through the **unconfirmed** branch,
never through success: the request may well have been delivered, so the visitor
gets the same neutral "could not confirm" message and a re-enabled button with
their input intact. 15s is deliberately generous — Apps Script's `/exec`
redirects to `script.googleusercontent.com` and a cold script start is slow, so
a timeout means genuinely stuck rather than merely slow.

### Validation order in `Code.gs`: sanitize first, then validate

`doPost` validates the **sanitized** values, not the raw ones. This ordering is
load-bearing and was a real bug: `nome: "<>"` is non-empty, so it passed the
raw required-field check; `sanitize()` then stripped the angle brackets to an
empty string, and the resulting blank-name enquiry still reserved a global send
slot and was emailed. Anything that sanitizes to empty now returns
`missing_fields` *before* `checkAndReserveSendSlot()` is reached.

Two ordering details that must survive any future edit:

- **Length is still checked on the raw values, before sanitizing.**
  `sanitize()` only ever shortens, so checking afterwards would let an
  oversized payload through whenever stripping happened to bring it under the
  cap.
- **Fields that are not strings count as missing.** `String({})` is
  `"[object Object]"` — non-empty, and it would pass a required-field check and
  be emailed verbatim. `asText()` treats any non-string as absent; this
  endpoint is public, so those bodies do get sent.

### Apps Script *does* send `Access-Control-Allow-Origin` (measured)

An automated review asserted that Apps Script "cannot add the
`Access-Control-Allow-Origin` header", that the cross-origin read will
therefore always fail, and that this design needs "a same-origin relay or a
different backend". **That is wrong**, and it was checked empirically rather
than reasoned about: `curl -L -D -` against a live Apps Script `/exec`
endpoint, sending an `Origin:` header, returns the header on *both* hops:

```
HTTP/2 302
access-control-allow-origin: *
location: https://script.googleusercontent.com/macros/echo?...

HTTP/2 404
access-control-allow-origin: *
```

Google's infrastructure attaches `access-control-allow-origin: *` on its own —
it is not something `ContentService` has to set, and there is nothing in
`Code.gs` that could add it. So the premise behind "rebuild this with a relay"
does not hold. **Do not re-architect this on that false premise**; if the read
ever does fail in practice, check the deployment's access setting first (step 3
of the runbook — it must be **Anyone**).

Recorded here because the claim is plausible-sounding, is repeated widely, and
would otherwise cost someone a rewrite.

### What is still unverified

The measurement above proves the header is present. It does **not** prove a
full successful JSON read end to end: the final hop in that test returned 404
(the `script.googleusercontent.com/macros/echo` URL appears to be single-use,
so replaying it by hand misses the body). A real submission from the deployed
page is still the only way to confirm the whole path, which is why the
first-deploy checklist below keeps its "response is actually readable" checks.

Cross-origin readability cannot be proven from the local suite either. The smoke
tests mock the endpoint via Playwright's `page.route()`, and Playwright fulfils
intercepted requests *below* the browser's CORS check — a fulfilled response is
readable whether or not it carries `Access-Control-Allow-Origin` (this was
measured, not assumed). The mocks therefore prove everything downstream of the
read — the branching, the per-code messages, and that nothing but a parsed
`result === 'success'` shows the success banner — but **not** that a real
`/exec` deployment returns a readable response to this origin.

That single fact has to be confirmed by hand on the first real deploy: see the
"response is actually readable" checks in the verification checklist below. If
it turns out not to hold, the form degrades to the neutral unconfirmed message
on every submission — never to a false success.

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
   - Who has access: **Anyone**. ⚠️ **Required, and not merely for
     convenience.** Only an "Anyone" deployment returns a response the browser
     is permitted to read cross-origin. With any other setting the read is
     blocked, the form can never confirm a send, and every submission — even a
     delivered one — shows the neutral "could not confirm" message. Do not
     substitute "Anyone with Google account".
4. Click **Deploy**. The first deploy will prompt an OAuth consent screen —
   review and authorize the requested `MailApp` (send email) scope.
5. Copy the resulting **Web app URL**. It must look exactly like
   `https://script.google.com/macros/s/<deployment-id>/exec` — the `/exec`
   suffix matters. A `/dev` URL is the editor-only test URL: it requires the
   deploying account to be signed in, so it fails for real visitors, and
   `contact-form.js` rejects it as unconfigured.
6. Paste that URL into `assets/js/contact-form.js`, replacing
   `PASTE_DEPLOYED_URL_HERE`:
   ```js
   const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/XXXXXXX/exec';
   ```
7. Commit that change (a public client file referencing a public "Anyone"
   Web App URL is the expected, accepted model here — see the code comment
   for why; pixelforge, the reference implementation, does the same).
8. Send one real test submission through the deployed site and confirm **both**
   that the email arrives at `geral@flowspace.pt` with all fields populated
   **and** that the browser actually read the response — see "response is
   actually readable" in the checklist below. This is the one property the
   local test suite cannot prove.

**Redeploying after editing `Code.gs`:** a plain "Deploy" from the editor
does **not** update the live Web App URL's behavior. You must go to
**Deploy → Manage deployments → (pencil icon) Edit → Version: New version →
Deploy**. This keeps the same `/exec` URL while pushing the new script logic
live.

> 🚨 **`Code.gs` is a reference copy — commits to it change nothing live.**
> The repo and the deployed Web App drift apart the moment either is edited
> alone. A security fix landed here is not in effect until someone re-pastes
> the file and publishes a **New version** as above. See "Mail security: the
> invariants `Code.gs` must never lose" below — the header-injection fix
> documented there is **pending redeploy**.

## Mail security: the invariants `Code.gs` must never lose

> ### 🚨 The fix described here is NOT live until someone redeploys
>
> `apps-script/Code.gs` in this repo is **only a reference copy**. Nothing in
> version control executes. The code that actually answers requests lives in
> the Apps Script project editor, and **it still contains the vulnerable
> version until a human pastes this file in and publishes a new version**:
>
> **Apps Script editor → paste the full contents of `apps-script/Code.gs` →
> Deploy → Manage deployments → (pencil) Edit → Version: **New version** →
> Deploy**
>
> A plain "Deploy" does **not** update the live Web App. Until the step above
> is done, the public endpoint keeps accepting header-injection payloads.

This endpoint is public, unauthenticated, deployed with access "Anyone", and it
sends email as the business. The account running it may well be
`geral@flowspace.pt` itself, so anything that lets a submitter steer delivery
is an open relay wearing the business's identity. Three invariants hold that
shut; all three are enforced in code, not by convention.

### 1. The recipient is never derived from request data

`to:` is the constant `CONFIG.TO_EMAIL` and nothing else. No field of the
request may reach it, directly or by concatenation. `IMMUTABLE_RECIPIENT`
duplicates the address on purpose, and `assertSendOptions()` — called
immediately before `MailApp.sendEmail` — refuses to send unless
`options.to === CONFIG.TO_EMAIL === 'geral@flowspace.pt'`. Editing `CONFIG`
alone fails closed rather than silently redirecting mail.

The same assertion refuses to send if a `cc`, `bcc`, `from`, `name`,
`htmlBody`, `attachments` or `inlineImages` option ever appears. The first four
would add or forge a delivery target; the last three would render
attacker-controlled markup or files in whoever opens the mail. The options
object passed today has exactly four keys: `to`, `replyTo`, `subject`, `body`.

### 2. The subject carries no free text

It used to be `'Novo contacto FlowSpace — ' + sanitized.nome`, and that was a
real header-injection hole: `sanitize()` strips only `<` and `>`, so CR and LF
survived it untouched. A `nome` of `"Ana\nBcc: vitima@exemplo.com"` reached
`MailApp.sendEmail` with the newline intact — and `Bcc:` is precisely the
header that turns this form into a relay.

The subject is now assembled from a constant prefix plus `especialidade` and
`interesse` only. Both have been compared by identity against
`ALLOWED_ESPECIALIDADE` / `ALLOWED_INTERESSE` before that point, so their only
possible values are the literals in `CONFIG`, which contain no control
characters. The visitor's name is in the **body**, where it belongs.

**Never reintroduce free text into the subject.** Not putting user input in a
header is a categorically stronger control than filtering it on the way in —
filtering is one missed encoding away from failing, and not being there cannot
fail at all.

### 3. Control characters are rejected, not stripped

`hasControlCharacters()` rejects any submission carrying a control character
with the error code `invalid_characters`, **before** `checkAndReserveSendSlot()`
runs — so a probe cannot burn the global send quota either.

Rejecting beats stripping. Stripping would launder
`"Ana\nBcc: vitima@exemplo.com"` into a normal-looking enquiry, mail it, and
leave nobody any the wiser that the endpoint was being probed. Rejecting is
unambiguous about what was delivered and makes an attack in progress visible.

The check applies to **every** field, not only the ones that currently reach a
header — a future edit that promotes a field into the subject must not silently
reopen this. One deliberate exception: `mensagem` comes from a `<textarea>`
where line breaks are the entire point, so it permits TAB/LF/CR while still
rejecting the rest of the C0 range and DEL. That exception is safe only because
`mensagem` never reaches a header, and `assertSendOptions()` enforces *that* at
the send boundary rather than trusting a comment to survive.

### `replyTo` is a claimed, unverified address

`replyTo: sanitized.email` is the one attacker-influenced header value. It is
constrained by `EMAIL_REGEX` (whose `\s` class excludes CR and LF, and whose
`$` anchors at true end-of-string — there is no `m` flag), that validation runs
before the send on every path, and `assertSendOptions()` re-checks it.

But it is **not a verified identity**. Nothing proves the submitter owns that
address. Hitting Reply in the business inbox replies to whatever they typed.
The body prints the same address on its own line precisely so the reader can
cross-check before replying — **keep that line.**

### ⚠️ `invalid_characters` has no client message yet

`assets/js/contact-form.js` is out of scope for the change that added the code,
so `ERROR_MESSAGES` has no entry for `invalid_characters` and it currently
degrades to the neutral "could not confirm" message. That is safe but
unhelpful — **add a Portuguese message for it.**

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
   same caveat pixelforge documents for its own limiter. Its worst case is one
   extra mail per address, which is why best-effort is acceptable *here*.
2. **Global cap** — **15 sends/hour** and **50 sends/day**, counted across
   all submitters and keyed on nothing the submitter controls. **Both windows
   live in `PropertiesService`, which is durable.**

The hourly window used to live in `CacheService`, and that made the cap a claim
rather than a control: cache entries can be evicted at any time before their
TTL, an evicted counter reads back as `0`, and the window silently restarts
with a fresh 15 sends. A limiter whose state can vanish under load is exactly
the limiter that fails when it matters — and unlike layer 1 this one is
presented as real protection for the `MailApp` quota, so it now matches its
claim. Both counters advance in a single `setProperties()` call inside the same
`LockService` critical section, so a mid-write failure cannot count the hour
without the day.

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
- [ ] Same checks with a *malformed* URL — all refused. An origin-only check
      accepted the last four of these, which is why the guard now matches the
      full `/macros/s/<id>/exec` path:
      - `http://example.com/exec` (wrong host)
      - `https://example.com/macros/s/AKfy.../exec` (wrong host, right shape)
      - `https://script.google.com/` (right host, no path)
      - `https://script.google.com/macros/s/AKfy.../dev` (editor-only URL)
      - `https://script.google.com/macros/AKfy.../exec` (missing `/s/`)
      - `http://script.google.com/macros/s/AKfy.../exec` (not https)

**Contact form — response is actually readable** (the one thing no local test
can prove; check on the first deploy and after any redeploy that changes the
access setting)
- [ ] With the deployed URL in place, submit a valid message with the devtools
      **Network** tab open. The `/exec` request 302s to
      `script.googleusercontent.com`; the final response must be **status 200
      with a readable JSON body** `{"result":"success",...}` and carry an
      `Access-Control-Allow-Origin` response header.
- [ ] The **Console** shows no CORS error and no
      `could not read the contact form response` message.
- [ ] The success banner appears. If instead you get "Não conseguimos confirmar
      o envio" *and* the email still arrives, the send works but the read is
      blocked — re-check that the deployment's access is **Anyone** (step 3),
      and that it was redeployed as a **New version** (see below). Do not
      "fix" this by reverting to `mode: 'no-cors'`; that restores the false
      success this design exists to prevent.

**Contact form — error paths** (each shows its own message and **never** the
success banner; the entered values must survive so the visitor can retry)
- [ ] `rate_limited` — submit twice with the same email inside the 5-minute
      cooldown, waiting out the 5-second client cooldown between attempts.
      Expect "Recebemos demasiados pedidos neste momento…".
- [ ] `invalid_option` — tamper a dropdown past the client mirror
      (`const s = document.getElementById('especialidade'); s.appendChild(Object.assign(document.createElement('option'), {value:'Cardiologia'})); s.value='Cardiologia';`)
      and force a submit. The client catches it first and shows the inline
      field error with no request; to reach the server message, comment out
      the client enum check locally and expect "A especialidade ou o interesse
      selecionado não é válido…".
- [ ] `stale_or_future_timestamp` — leave the page open for over an hour, then
      submit. Expect "O formulário esteve aberto demasiado tempo…".
- [ ] Unconfirmed — go offline (devtools → Network → Offline) and submit.
      Expect the neutral "Não conseguimos confirmar o envio da tua mensagem…",
      **not** a hard failure and **not** a success. A hard "failed" on a
      message that did send causes duplicate submissions.
- [ ] Unconfirmed — with devtools, override the response to non-JSON (or point
      `APPS_SCRIPT_URL` at a deployment returning an error page). Same neutral
      message, no success banner.
- [ ] Unconfirmed (timeout) — devtools → Network → throttle to "Offline" *after*
      clicking submit, or use a request-blocking rule that stalls the `/exec`
      request. Within ~15s the neutral "Não conseguimos confirmar o envio…"
      appears, the button returns to "Enviar mensagem" and is clickable again,
      and the entered values are still there. The bug this replaced left the
      button on "A enviar…" forever.
- [ ] `missing_fields` on a value that sanitizes away — submit with
      `nome` set to `<>` via devtools
      (`document.getElementById('nome').value = '<>'`, then submit). Expect
      "Faltam dados obrigatórios…" and **no** email at `geral@flowspace.pt`.
      Before the validation reorder this reserved a send slot and mailed a
      blank-name enquiry.

**Mail security** (after the redeploy — see "Mail security" below)
- [ ] Submit with `nome` set to a header-injection payload via devtools
      (`document.getElementById('nome').value = 'Ana\nBcc: ' + 'you@yourdomain.test'`)
      and force a submit. **No mail may arrive at that Bcc address**, and none
      at `geral@flowspace.pt` either — the request is rejected before sending.
- [ ] A normal submission's email has subject
      `Novo contacto FlowSpace — <especialidade> / <interesse>` with **no
      visitor-supplied text in it**, and the name appears in the body.
- [ ] The received mail has exactly one recipient, `geral@flowspace.pt`, and no
      Cc or Bcc (check "Show original" / full headers, not just the client UI).

**Contact form — normal operation**
- [ ] Submitting with each required field empty (nome, email, especialidade,
      interesse) in turn shows that field's inline error and does not submit.
- [ ] An invalid email (e.g. `foo@bar`) is rejected client-side.
- [ ] A dropdown value tampered past the allowlist (see `invalid_option`
      above) shows that field's inline error and fires **no** request. The
      three `especialidade` and four `interesse` values in
      `ALLOWED_ESPECIALIDADE`/`ALLOWED_INTERESSE` must match the `<option>`
      values in `index.html` and `CONFIG` in `Code.gs` — all three lists
      still agree.
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
- [ ] The hourly counter is durable: after tripping the cap, check
      **Project Settings → Script Properties** in the Apps Script editor and
      confirm `flowspace-global-hour` / `flowspace-global-hour-count` are
      present with the current window and a count of 15. Cache eviction cannot
      be forced by hand, so this property being the source of truth is the
      observable part; the eviction case itself is only covered in simulation
      (see "What is verified only in simulation" below).

**GitHub Pages deploy** (after the first successful Actions run)
- [ ] The published site serves `/`, `/privacidade.html` and everything under
      `/assets/`.
- [ ] `/README.md`, `/apps-script/Code.gs`, `/tests/smoke.spec.ts` and
      `/tests/package.json` all return **404** on the live site. `Code.gs`
      leaking the honeypot field name and the rate-limit thresholds is the
      reason the allowlist exists.
- [ ] The Actions log's "Stage publishable site files" step lists exactly the
      files you expect under "Publishing:" — check anything newly added is
      there rather than under "Not published".
- [ ] Before the Apps Script URL is committed, the run fails at "Require a
      configured Apps Script URL" and publishes nothing. This is expected; see
      "Deploying to GitHub Pages" above.

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
`flowspace-site/` automatically, so no separate preview server is needed.
21 tests, all passing at time of writing. They assert:

- the hero copy renders, and the Google Maps link href is exactly correct;
- a mocked `{"result":"success"}` shows the success banner, clears the form,
  and that the request went out as `Content-Type: text/plain;charset=utf-8` —
  the simple-request property that makes the response readable at all;
- each of the six mocked error codes shows **its own** Portuguese message,
  keeps the entered values, re-enables the button, and shows **no** success
  banner;
- an unrecognised error code, an unparseable body (an HTML error page), and a
  request that fails outright all show the neutral "could not confirm"
  message — never success, never a hard failure;
- a **stalled** request (a route that never settles) hits the
  `REQUEST_TIMEOUT_MS` deadline, shows the same neutral message, and leaves the
  button enabled and back to "Enviar mensagem" with the visitor's input intact.
  The spec rewrites the deadline down so it doesn't wait 15s; it was confirmed
  to fail when the `AbortController` signal is removed;
- the **unconfigured** placeholder, and four same-host-but-malformed URLs,
  disable the submit button, show the unavailable banner, and produce neither
  a request nor a success banner;
- a `<select>` tampered past the client allowlist is caught before any
  request;
- field errors set `aria-invalid` on their controls and clear it once fixed;
- the menu toggle's `aria-label`/`aria-expanded`/`aria-controls` behave.

Because the committed `APPS_SCRIPT_URL` is the placeholder, the spec rewrites
that constant in the served script via `page.route()` rather than adding a
test-only override hook to the production file, and stubs the endpoint so no
real request leaves the machine.

**What these tests cannot prove:** that a real deployment's response is
readable cross-origin. Playwright fulfils intercepted requests below the
browser's CORS check, so the mocks are readable regardless of headers (the
stubs set `Access-Control-Allow-Origin` anyway, because that is what
production must send). Everything downstream of the read is covered; the read
itself is confirmed by hand on the first deploy — see "response is actually
readable" in the checklist above.

`apps-script/Code.gs` is **not** covered here — it needs a real Apps Script
runtime and a Google account authorized to send as `geral@flowspace.pt`, so
it cannot run locally. Verify it via the checklist above after deploying.

### What is verified only in simulation

The `Code.gs` changes (validating sanitized values, the durable hourly cap, and
the mail-security invariants above) were exercised in a throwaway Node harness
with hand-written stand-ins for `LockService`, `CacheService`,
`PropertiesService`, `MailApp`, `Utilities` and `ContentService` — including a
forced full cache eviction, which proved the hourly cap still rejects because
the count lives in `PropertiesService`. That harness is **not committed**: it is
a sketch of Apps Script's semantics, not Apps Script, and keeping it would
invite mistaking it for real coverage.

The mail-hardening pass ran **205 checks, all passing**, capturing the exact
options object handed to a stubbed `MailApp.sendEmail`: control characters
rejected in every field across ten payloads (LF, CRLF, bare CR, NUL, VT, FF,
ESC, DEL, TAB, and CR/LF carrying a `Bcc:`/`Cc:` header) with no mail sent;
`to === 'geral@flowspace.pt'` and exactly the keys `to`/`replyTo`/`subject`/
`body` across twelve benign and hostile submissions; the subject proven equal
to its constant-plus-enum form with the name absent; the enum allowlists,
length caps, email regex, honeypot, malformed bodies and both rate-limit layers
still gating; and the guard itself refusing every forbidden option key. The
same harness was run against the **pre-fix** file as a negative control: 58 of
191 checks failed there, and `nome: "Ana\nBcc: vitima@exemplo.com"` reached
`sendEmail` with the newline intact — so the checks fail when the bug is
present rather than passing vacuously.

So: the *logic* was executed and behaves as described, but **nothing here has
run on Google's runtime**. In particular, whether `MailApp` itself would have
neutralised an embedded newline is **unknown and untested** — that is exactly
why the defence is at our layer and not left to the platform. Real
`CacheService` eviction timing, real `PropertiesService` durability and quota
limits, and real `LockService` contention are likewise unproven until the
script is deployed. The `Code.gs`-dependent items in the manual checklist
remain the actual gate.

## Testing

No pytest/Vitest suite applies here — there's no Python and no framework
components, just static HTML/CSS/JS. The manual checklist above is the
actual verification gate, proportionate to what this deliverable is.
