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
 * Handle POST requests from the FlowSpace contact form.
 */
function doPost(e) {
  let data;
  try {
    data = JSON.parse(e.postData.contents);
  } catch (err) {
    return errorResponse('invalid_payload');
  }

  // Honeypot: non-empty means a bot filled a field real users never see.
  // Return success silently — do not reveal the check exists.
  if (data[CONFIG.HONEYPOT_FIELD]) {
    return successResponse();
  }

  const missing = ['nome', 'email', 'especialidade', 'interesse', 'timestamp'].filter(
    function (field) {
      return !data[field] || String(data[field]).trim() === '';
    }
  );
  if (missing.length > 0) {
    return errorResponse('missing_fields');
  }

  const nome = String(data.nome);
  const email = String(data.email);
  const especialidade = String(data.especialidade);
  const interesse = String(data.interesse);
  const mensagem = data.mensagem ? String(data.mensagem) : '';

  if (
    nome.length > CONFIG.MAX_NOME_LENGTH ||
    email.length > CONFIG.MAX_EMAIL_LENGTH ||
    especialidade.length > CONFIG.MAX_ENUM_LENGTH ||
    interesse.length > CONFIG.MAX_ENUM_LENGTH ||
    mensagem.length > CONFIG.MAX_MENSAGEM_LENGTH
  ) {
    return errorResponse('field_too_long');
  }

  if (!EMAIL_REGEX.test(email)) {
    return errorResponse('invalid_email');
  }

  if (
    CONFIG.ALLOWED_ESPECIALIDADE.indexOf(especialidade) === -1 ||
    CONFIG.ALLOWED_INTERESSE.indexOf(interesse) === -1
  ) {
    return errorResponse('invalid_option');
  }

  const submittedTime = new Date(data.timestamp);
  const now = new Date();
  if (
    isNaN(submittedTime.getTime()) ||
    submittedTime.getTime() < now.getTime() - CONFIG.TIMESTAMP_MAX_AGE_MS ||
    submittedTime.getTime() > now.getTime() + CONFIG.TIMESTAMP_MAX_FUTURE_MS
  ) {
    return errorResponse('stale_or_future_timestamp');
  }

  const sanitized = sanitize({ nome: nome, email: email, especialidade: especialidade, interesse: interesse, mensagem: mensagem });

  // Rate limiting without a Sheet: pixelforge scans its Sheet for prior
  // submissions from the same email within a window. We have no Sheet, so we
  // use CacheService.getScriptCache() keyed on the sanitized email instead.
  // This is best-effort and per-script only — it does not survive a script
  // restart/redeploy and is not a durable guarantee, the same caveat
  // pixelforge documents for its own rate limiter, just without the Sheet
  // dependency. See SECURITY.md-equivalent notes in flowspace-site/README.md.
  const cache = CacheService.getScriptCache();
  const cacheKey = 'flowspace-submission:' + sanitized.email;
  if (cache.get(cacheKey)) {
    return errorResponse('rate_limited');
  }
  cache.put(cacheKey, '1', CONFIG.RATE_LIMIT_TTL_SECONDS);

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
 * Trim all strings, strip angle brackets from free-text fields, and
 * lowercase the email for consistent rate-limit keys.
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
