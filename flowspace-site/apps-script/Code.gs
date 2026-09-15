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

  try {
    MailApp.sendEmail({
      to: CONFIG.TO_EMAIL,
      replyTo: sanitized.email,
      subject: 'Novo contacto FlowSpace — ' + sanitized.nome,
      body: [
        'Nome: ' + sanitized.nome,
        'Email: ' + sanitized.email,
        'Especialidade: ' + sanitized.especialidade,
        'Interesse: ' + sanitized.interesse,
        'Mensagem: ' + (sanitized.mensagem || '(sem mensagem)'),
        '',
        'Submetido em: ' + now.toISOString(),
      ].join('\n'),
    });
  } catch (err) {
    // Most likely cause: MailApp's daily send quota was exhausted. A
    // consumer Google account caps at roughly 100 MailApp sends/day; a
    // Google Workspace account has a much higher cap. See the README runbook.
    return errorResponse('send_failed');
  }

  return successResponse();
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
