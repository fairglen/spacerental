/**
 * FlowSpace contact form — Google Apps Script Web App backend.
 *
 * Adapted from pixelforge's google-apps-script.js (github.com/fairglen/pixelforge)
 * with all SpreadsheetApp/Sheet logging removed. This is a deliberate, explicit
 * omission for this pass — not a stub left "just in case". See
 * flowspace-site/README.md ("Sheet logging intentionally not implemented")
 * for the rationale and the follow-up note in TODO.md (F01).
 *
 * This file is a reference copy kept in version control. The runtime that
 * actually serves requests lives in the Apps Script project editor — paste
 * this file's contents there. See the deploy runbook in
 * flowspace-site/README.md for exact steps.
 */

const CONFIG = {
  TO_EMAIL: 'geral@flowspace.pt',
  MAX_NOME_LENGTH: 120,
  MAX_EMAIL_LENGTH: 254,
  MAX_ENUM_LENGTH: 40,
  MAX_MENSAGEM_LENGTH: 2000,
  TIMESTAMP_MAX_AGE_MS: 60 * 60 * 1000, // 1 hour
  TIMESTAMP_MAX_FUTURE_MS: 5 * 60 * 1000, // 5 minutes
  RATE_LIMIT_TTL_SECONDS: 5 * 60, // 5 minutes, CacheService max is 6 hours
  // Global circuit breaker (see checkAndReserveSendSlot). The per-email limit
  // below keys on attacker-supplied data, so a bot cycling unique valid
  // addresses walks straight past it; Apps Script exposes no requester IP, so
  // an IP-based limit is not available to us. These caps are the fallback:
  // they bound total sends per window regardless of who submitted.
  //
  // Deliberate tradeoff: a genuine burst of traffic (a newsletter mention, a
  // conference) can trip these and turn real enquiries away. That is the
  // preferred failure — a bot exhausting MailApp's ~100/day consumer quota
  // would silently kill *all* lead delivery for the rest of the day, and we
  // would not even see the rejections. Raise these if real traffic warrants
  // it; add a CAPTCHA (see README) if spam is the reason they keep tripping.
  GLOBAL_HOURLY_LIMIT: 15,
  GLOBAL_DAILY_LIMIT: 50,
  LOCK_TIMEOUT_MS: 5000,
  ALLOWED_ESPECIALIDADE: ['Psicologia', 'Psiquiatria', 'Outra'],
  ALLOWED_INTERESSE: [
    'Reserva avulsa',
    'Pack 10 horas',
    'Reserva recorrente',
    'Só quero saber mais',
  ],
  // Hidden field a bot autofiller might target that this form doesn't
  // otherwise have. Any non-empty value here means the request came from a
  // bot; we pretend it succeeded (see doPost) rather than reveal the check.
  HONEYPOT_FIELD: 'assunto2',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The single address this endpoint is ever permitted to deliver to.
 *
 * Deliberately duplicated from CONFIG.TO_EMAIL rather than read from it:
 * assertSendOptions() compares the two, so an edit that points CONFIG at some
 * other address fails closed instead of quietly redirecting the business's
 * outbound mail. This constant is the invariant; CONFIG.TO_EMAIL is the
 * (checked) configuration.
 */
const IMMUTABLE_RECIPIENT = 'geral@flowspace.pt';

/**
 * Option keys MailApp.sendEmail accepts that would either add a delivery
 * target (cc, bcc), let the submitter dress the mail up as someone else
 * (name, from), or render attacker-controlled markup in the reader's client
 * (htmlBody, attachments, inlineImages). None of them is ever passed; the
 * assertion below refuses to send if one appears.
 */
const FORBIDDEN_MAIL_OPTIONS = [
  'cc',
  'bcc',
  'from',
  'name',
  'htmlBody',
  'attachments',
  'inlineImages',
];

/**
 * Control characters, in two strictnesses.
 *
 * CR and LF are the ones that matter: an email header is terminated by CRLF,
 * so any submitted value carrying one and then interpolated into a header
 * lets the submitter append headers of their own — `Bcc:` above all, which
 * turns this form into an open relay sending as the business. The rest of the
 * C0 range (and DEL) has no legitimate place in a web form field either, and
 * allowing it only leaves room for the next trick.
 *
 * STRICT applies to every single-line field. MULTILINE, which permits only
 * TAB/LF/CR, applies to `mensagem` alone — it comes from a <textarea> where
 * line breaks are the point. That exception is safe only because `mensagem`
 * never reaches a header, and assertSendOptions() enforces that at the send
 * boundary rather than trusting this comment to survive a future edit.
 */
const CONTROL_CHARS_STRICT = /[\u0000-\u001F\u007F]/;
const CONTROL_CHARS_MULTILINE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

// PropertiesService keys for the global caps. Both windows live here rather
// than in CacheService: see checkAndReserveSendSlot.
const PROP_KEYS = {
  HOUR_WINDOW: 'flowspace-global-hour',
  HOUR_COUNT: 'flowspace-global-hour-count',
  DAY_WINDOW: 'flowspace-global-day',
  DAY_COUNT: 'flowspace-global-day-count',
};

/**
 * Handle POST requests from the FlowSpace contact form.
 *
 * The browser sends this body with Content-Type: text/plain;charset=utf-8, not
 * application/json — that keeps the request a CORS "simple request" so no
 * preflight is sent (Apps Script cannot answer an OPTIONS preflight), which in
 * turn is what lets the page read this response instead of an opaque one. The
 * declared content type is irrelevant here: the body is a JSON string either
 * way and e.postData.contents is the raw text.
 *
 * The client branches on the { result, error } shape returned below, so an
 * error code added here needs a matching Portuguese message in
 * assets/js/contact-form.js (ERROR_MESSAGES); an unmapped code degrades to the
 * neutral "could not confirm" message rather than a false success.
 *
 * TODO: 'invalid_characters' has no ERROR_MESSAGES entry yet, so it currently
 * degrades to that neutral message. Safe, but unhelpful — add one.
 */
function doPost(e) {
  // A GET, an empty POST, or a probe with no body arrives with no postData at
  // all. Reading .contents off it would throw a TypeError and surface as a
  // 500 HTML error page, which the client can only treat as unconfirmed.
  if (!e || !e.postData || typeof e.postData.contents !== 'string') {
    return errorResponse('invalid_payload');
  }

  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorResponse('invalid_payload');
  }

  // JSON.parse succeeds on 'null', '"x"', '3' and '[]' — all of which would
  // then throw a TypeError (or read nonsense) on the property access below and
  // surface as a 500 instead of a clean invalid_payload. This endpoint is
  // public, so those bodies can and will be sent directly.
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return errorResponse('invalid_payload');
  }

  // Honeypot: non-empty means a bot filled a field real users never see.
  // Return success silently — do not reveal the check exists.
  if (data[CONFIG.HONEYPOT_FIELD]) {
    return successResponse();
  }

  const raw = {
    nome: asText(data.nome),
    email: asText(data.email),
    especialidade: asText(data.especialidade),
    interesse: asText(data.interesse),
    mensagem: asText(data.mensagem),
  };

  // Length is checked against what was actually sent, before sanitization:
  // sanitize() only ever shortens a value, so checking afterwards would let an
  // oversized payload through whenever stripping happened to bring it under
  // the cap.
  if (
    raw.nome.length > CONFIG.MAX_NOME_LENGTH ||
    raw.email.length > CONFIG.MAX_EMAIL_LENGTH ||
    raw.especialidade.length > CONFIG.MAX_ENUM_LENGTH ||
    raw.interesse.length > CONFIG.MAX_ENUM_LENGTH ||
    raw.mensagem.length > CONFIG.MAX_MENSAGEM_LENGTH
  ) {
    return errorResponse('field_too_long');
  }

  // Reject control characters outright — do not strip them.
  //
  // Stripping would hide an attack in progress: a payload carrying
  // "Ana\nBcc: vitima@exemplo.com" would be silently laundered into a normal
  // looking enquiry and mailed, and nobody would ever learn the endpoint was
  // being probed. Rejecting makes it visible in the client's error path and
  // leaves no ambiguity about what was delivered.
  //
  // Applied to every field, not just the ones that currently reach a header.
  // `mensagem` only reaches the body today, but a future edit that promotes a
  // field into the subject must not silently reintroduce header injection.
  // This check runs before checkAndReserveSendSlot() so hostile payloads
  // cannot burn the global send quota.
  if (hasControlCharacters(raw)) {
    return errorResponse('invalid_characters');
  }

  // Sanitize first, then validate what sanitization actually produced.
  //
  // Validating the raw values instead was a real bug: nome: "<>" is non-empty,
  // so it passed the required-field check; sanitize() then stripped the angle
  // brackets to an empty string, and the blank-name enquiry still reserved a
  // send slot and was mailed. Everything below — required, email, enum — must
  // therefore run on `sanitized`, which is also exactly what gets emailed.
  const sanitized = sanitize(raw);

  const timestamp = asText(data.timestamp).trim();
  const missing = ['nome', 'email', 'especialidade', 'interesse'].filter(function (field) {
    return sanitized[field] === '';
  });
  if (missing.length > 0 || timestamp === '') {
    return errorResponse('missing_fields');
  }

  if (!EMAIL_REGEX.test(sanitized.email)) {
    return errorResponse('invalid_email');
  }

  if (
    CONFIG.ALLOWED_ESPECIALIDADE.indexOf(sanitized.especialidade) === -1 ||
    CONFIG.ALLOWED_INTERESSE.indexOf(sanitized.interesse) === -1
  ) {
    return errorResponse('invalid_option');
  }

  const submittedTime = new Date(timestamp);
  const now = new Date();
  if (
    isNaN(submittedTime.getTime()) ||
    submittedTime.getTime() < now.getTime() - CONFIG.TIMESTAMP_MAX_AGE_MS ||
    submittedTime.getTime() > now.getTime() + CONFIG.TIMESTAMP_MAX_FUTURE_MS
  ) {
    return errorResponse('stale_or_future_timestamp');
  }

  const rejection = checkAndReserveSendSlot(sanitized.email);
  if (rejection) {
    return errorResponse(rejection);
  }

  // THE RECIPIENT IS NEVER DERIVED FROM REQUEST DATA.
  //
  // `to` is the constant CONFIG.TO_EMAIL and nothing else — no field of
  // `data`, `raw` or `sanitized` may ever reach it, directly or by
  // concatenation. assertSendOptions() re-checks that at the send boundary
  // and refuses to send if it ever stops holding.
  //
  // The subject carries NO free text. It is assembled from a constant prefix
  // plus `especialidade` and `interesse`, both of which have just been
  // checked against ALLOWED_ESPECIALIDADE / ALLOWED_INTERESSE by identity —
  // so their only possible values are the literals in CONFIG, which contain
  // no control characters. The visitor's name used to be interpolated here
  // and was a header-injection hole; it belongs in the body, where it now is.
  // Never put a free-text field in this string: not putting user input in a
  // header is a far stronger control than trying to filter it on the way in.
  //
  // `replyTo` is the one attacker-influenced header value, constrained to
  // EMAIL_REGEX above (whose \s class excludes CR/LF, and whose $ anchors at
  // true end-of-string — no `m` flag). It is a CLAIMED, UNVERIFIED address:
  // hitting Reply from the business inbox replies to whatever the submitter
  // typed, not to a proven identity. The body prints the same address on its
  // own line precisely so the reader can cross-check before replying — keep
  // that line.
  //
  // No cc, bcc, from, name, htmlBody, attachments or inlineImages option is
  // passed. The first four would add or forge a delivery target; the last
  // three would render attacker-controlled markup or files in the reader's
  // mail client. See FORBIDDEN_MAIL_OPTIONS.
  const mailOptions = {
    to: CONFIG.TO_EMAIL,
    replyTo: sanitized.email,
    subject:
      'Novo contacto FlowSpace — ' +
      sanitized.especialidade +
      ' / ' +
      sanitized.interesse,
    body: [
      'Nome: ' + sanitized.nome,
      'Email: ' + sanitized.email,
      'Especialidade: ' + sanitized.especialidade,
      'Interesse: ' + sanitized.interesse,
      'Mensagem: ' + (sanitized.mensagem || '(sem mensagem)'),
      '',
      'Submetido em: ' + now.toISOString(),
    ].join('\n'),
  };

  if (!assertSendOptions(mailOptions)) {
    // Fail closed. Reaching here means a code change broke the recipient
    // invariant or reintroduced a header-unsafe value; sending anyway is the
    // one outcome worse than dropping this enquiry.
    return errorResponse('send_failed');
  }

  try {
    MailApp.sendEmail(mailOptions);
  } catch (err) {
    // Most likely cause: MailApp's daily send quota was exhausted. A
    // consumer Google account caps at roughly 100 MailApp sends/day; a
    // Google Workspace account has a much higher cap. See the README runbook.
    return errorResponse('send_failed');
  }

  return successResponse();
}

/**
 * True if any submitted field contains a control character.
 *
 * Checked on the RAW values, before trimming: trim() would quietly discard a
 * leading or trailing CR/LF, so a check placed after it reports "clean" on a
 * payload that did in fact carry one. We want to know what was submitted.
 *
 * Every field gets CONTROL_CHARS_STRICT except `mensagem`, a <textarea> whose
 * whole purpose is multi-line text; it gets CONTROL_CHARS_MULTILINE, which
 * still rejects the rest of the C0 range and DEL. See the regex comments.
 */
function hasControlCharacters(fields) {
  return (
    CONTROL_CHARS_STRICT.test(fields.nome) ||
    CONTROL_CHARS_STRICT.test(fields.email) ||
    CONTROL_CHARS_STRICT.test(fields.especialidade) ||
    CONTROL_CHARS_STRICT.test(fields.interesse) ||
    CONTROL_CHARS_MULTILINE.test(fields.mensagem)
  );
}

/**
 * Last line of defence before MailApp.sendEmail: prove the options object
 * still honours the invariants this file is built on.
 *
 * This exists to catch a *code* mistake, not a submitter — every submitted
 * value has already been validated by the time we get here. It is cheap, and
 * the failure it guards against (mail delivered somewhere other than
 * geral@flowspace.pt, sent as the business) is the worst outcome this
 * endpoint has.
 *
 * @return {boolean} true if the send may proceed.
 */
function assertSendOptions(options) {
  if (!options || typeof options !== 'object') return false;

  // The recipient is a constant, never request data. Both spellings must
  // agree, so editing CONFIG.TO_EMAIL alone fails closed.
  if (options.to !== IMMUTABLE_RECIPIENT) return false;
  if (CONFIG.TO_EMAIL !== IMMUTABLE_RECIPIENT) return false;

  // No option that would add a delivery target or render markup.
  for (let i = 0; i < FORBIDDEN_MAIL_OPTIONS.length; i++) {
    if (Object.prototype.hasOwnProperty.call(options, FORBIDDEN_MAIL_OPTIONS[i])) {
      return false;
    }
  }

  // Every value that lands in a header must be free of control characters,
  // whatever path it took to get here. This is the check that makes the
  // `mensagem` newline exemption safe: if a future edit moves `mensagem` (or
  // any other free text) into the subject, the send stops here instead of
  // injecting headers.
  if (typeof options.subject !== 'string') return false;
  if (CONTROL_CHARS_STRICT.test(options.subject)) return false;
  if (typeof options.replyTo !== 'string') return false;
  if (CONTROL_CHARS_STRICT.test(options.replyTo)) return false;
  if (!EMAIL_REGEX.test(options.replyTo)) return false;

  return true;
}

/**
 * Decide whether this submission may send mail, and consume its slot if so.
 *
 * Two layers, both enforced here:
 *
 * 1. Per-email cooldown (CacheService, RATE_LIMIT_TTL_SECONDS). pixelforge
 *    scans its Sheet for prior submissions from the same email; we have no
 *    Sheet, so we use the script cache. Best-effort and per-script only — it
 *    does not survive a runtime restart or a redeploy, the same caveat
 *    pixelforge documents for its own limiter. On its own it is bypassed by
 *    any bot that varies the address, which is why layer 2 exists.
 * 2. Global caps (CONFIG.GLOBAL_HOURLY_LIMIT / GLOBAL_DAILY_LIMIT), keyed on
 *    nothing the submitter controls. See the tradeoff note in CONFIG. These
 *    are fixed calendar-hour and UTC-day windows rather than true rolling
 *    ones — the boundary lets at most one extra window's worth through, which
 *    is well inside the margin these caps leave against the MailApp quota.
 *
 *    Both windows are stored in PropertiesService, which is durable. The
 *    hourly window used to live in CacheService, and that made the cap a
 *    claim rather than a control: cache entries can be evicted at any time
 *    before their TTL, and an evicted counter reads back as 0, resetting the
 *    window and handing out a fresh 15 sends. A limiter whose state can
 *    vanish under load is exactly the limiter that fails when it matters.
 *    CacheService is still used for layer 1, which is documented as
 *    best-effort and whose worst case is one extra mail per address.
 *
 * The whole check-and-set runs under a script lock: without it two concurrent
 * executions both read the same counts, both find room, and both send, which
 * defeats every count above. If the lock cannot be taken we fail closed (rate_limited)
 * rather than send unchecked.
 *
 * Slots are consumed before the send, so a send that then fails still counts.
 * That is the conservative direction — MailApp failures are usually quota
 * exhaustion, and retrying into an exhausted quota helps nobody.
 *
 * @return {?string} an error code to return to the caller, or null to proceed.
 */
function checkAndReserveSendSlot(email) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(CONFIG.LOCK_TIMEOUT_MS);
  } catch (err) {
    return 'rate_limited';
  }

  try {
    const cache = CacheService.getScriptCache();

    // Hash the address: CacheService keys cap at 250 characters, and
    // MAX_EMAIL_LENGTH (254) plus this prefix can exceed that on its own —
    // non-ASCII addresses hit the limit sooner still. A raw key would throw
    // here, before the mail is ever sent.
    const emailKey = 'flowspace-submission:' + sha256Hex(email).slice(0, 32);
    if (cache.get(emailKey)) {
      return 'rate_limited';
    }

    const now = new Date();
    const properties = PropertiesService.getScriptProperties();
    // One read for all four values: getProperties() is a single API call, and
    // both windows have to be consistent with each other within this lock.
    const stored = properties.getProperties();

    const hourWindow = String(Math.floor(now.getTime() / (60 * 60 * 1000)));
    const hourCount = stored[PROP_KEYS.HOUR_WINDOW] === hourWindow
      ? Number(stored[PROP_KEYS.HOUR_COUNT]) || 0
      : 0;
    if (hourCount >= CONFIG.GLOBAL_HOURLY_LIMIT) {
      return 'rate_limited';
    }

    const today = now.toISOString().slice(0, 10);
    const dayCount = stored[PROP_KEYS.DAY_WINDOW] === today
      ? Number(stored[PROP_KEYS.DAY_COUNT]) || 0
      : 0;
    if (dayCount >= CONFIG.GLOBAL_DAILY_LIMIT) {
      return 'rate_limited';
    }

    // Both counters advance in one setProperties call, so a failure mid-write
    // cannot leave the hour counted and the day not (or the reverse).
    const update = {};
    update[PROP_KEYS.HOUR_WINDOW] = hourWindow;
    update[PROP_KEYS.HOUR_COUNT] = String(hourCount + 1);
    update[PROP_KEYS.DAY_WINDOW] = today;
    update[PROP_KEYS.DAY_COUNT] = String(dayCount + 1);
    properties.setProperties(update);

    cache.put(emailKey, '1', CONFIG.RATE_LIMIT_TTL_SECONDS);

    return null;
  } finally {
    lock.releaseLock();
  }
}

/**
 * Hex-encoded SHA-256 of a string. Used only to bound cache key length.
 */
function sha256Hex(value) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function (byte) {
      return ('0' + (byte & 0xff).toString(16)).slice(-2);
    })
    .join('');
}

/**
 * Coerce a submitted field to a string, treating anything that is not already
 * one as absent.
 *
 * Not String(value): this endpoint is public, so `{}` and `[]` can and will be
 * submitted, and String() turns them into "[object Object]" / "" — the first
 * of which is non-empty, passes the required-field check, and gets emailed
 * verbatim. A field that isn't a string is missing, not a value.
 */
function asText(value) {
  return typeof value === 'string' ? value : '';
}

/**
 * Trim all strings, strip angle brackets from free-text fields, and
 * lowercase the email for consistent rate-limit keys.
 *
 * Callers must validate the *result* of this, not its input — see doPost.
 *
 * This function is NOT the defence against header injection and must never be
 * made to carry that job: stripping angle brackets does nothing about CR/LF,
 * and a strip-based defence hides the attack instead of surfacing it.
 * hasControlCharacters() rejects those payloads before this runs, and
 * assertSendOptions() re-checks at the send boundary.
 */
function sanitize(fields) {
  return {
    nome: fields.nome.trim().replace(/[<>]/g, ''),
    email: fields.email.trim().toLowerCase(),
    especialidade: fields.especialidade.trim(),
    interesse: fields.interesse.trim(),
    mensagem: fields.mensagem.trim().replace(/[<>]/g, ''),
  };
}

function successResponse() {
  return ContentService.createTextOutput(
    JSON.stringify({ result: 'success', message: 'Mensagem enviada com sucesso.' })
  ).setMimeType(ContentService.MimeType.JSON);
}

function errorResponse(errorCode) {
  return ContentService.createTextOutput(
    JSON.stringify({ result: 'error', error: errorCode })
  ).setMimeType(ContentService.MimeType.JSON);
}
