/**
 * FlowSpace contact form.
 *
 * Sends submissions to a Google Apps Script Web App (apps-script/Code.gs)
 * which emails geral@flowspace.pt via MailApp.sendEmail. There is no backend
 * of our own here — see flowspace-site/README.md for the full deploy runbook.
 *
 * The one safety property this file exists to hold:
 *
 *   A success banner is shown ONLY on positive confirmation — the response was
 *   read, parsed as JSON, and said result === 'success'. Never on "fetch()
 *   didn't throw".
 *
 * That property is why we do not use mode: 'no-cors'. An opaque response has
 * no readable status and no readable body, so every server-side rejection
 * (rate limited, mail quota exhausted, tampered enum value, malformed body)
 * is indistinguishable from a real send, and the visitor is told "Mensagem
 * enviada!" while their enquiry is dropped. Instead we make a CORS *simple
 * request* — POST with a text/plain;charset=utf-8 Content-Type, which is a
 * safelisted header value and so triggers no preflight. A Web App deployed
 * with access "Anyone" answers such a request with a readable, CORS-permitted
 * response (the /exec URL 302s to script.googleusercontent.com, and fetch
 * follows that redirect transparently). The body is still a JSON string;
 * Code.gs reads e.postData.contents and JSON.parses it regardless of the
 * declared content type.
 */
(function () {
  'use strict';

  // PASTE_DEPLOYED_URL_HERE is replaced with the real Apps Script Web App
  // URL after deployment. See "Apps Script deploy runbook" in
  // flowspace-site/README.md for the exact steps (create project, paste
  // Code.gs, deploy as Web App executing as "Me" with access "Anyone",
  // authorize the MailApp scope, then copy the /exec URL here).
  const APPS_SCRIPT_URL = 'PASTE_DEPLOYED_URL_HERE';

  const PLACEHOLDER_URL = 'PASTE_DEPLOYED_URL_HERE';

  // The full deployed Web App shape, not just the host. Checking only the
  // origin accepts https://script.google.com/ and every typo'd path on that
  // host; those reach fetch(), come back as an error page, and used to be
  // reported as a success.
  const WEB_APP_URL_PATTERN =
    /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{10,}\/exec$/;

  const SUBMIT_COOLDOWN_MS = 5000;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Mirrors CONFIG.ALLOWED_ESPECIALIDADE / CONFIG.ALLOWED_INTERESSE in
  // apps-script/Code.gs, and the <option> values in index.html. Defined once
  // here so the client checks cannot drift apart from each other. These give
  // immediate feedback only — Code.gs re-checks every value and is the real
  // enforcement. Never drop the server-side check in favour of this one.
  const ALLOWED_ESPECIALIDADE = ['Psicologia', 'Psiquiatria', 'Outra'];
  const ALLOWED_INTERESSE = [
    'Reserva avulsa',
    'Pack 10 horas',
    'Reserva recorrente',
    'Só quero saber mais',
  ];

  const CONTACT_FALLBACK =
    'Escreve-nos para geral@flowspace.pt e respondemos em menos de 24 horas.';

  const UNAVAILABLE_MESSAGE =
    'O formulário está temporariamente indisponível. ' + CONTACT_FALLBACK;

  // Shown when we could not read a definitive answer: fetch() threw (offline,
  // DNS failure, CORS actually blocked), the body was unreadable, or it did
  // not parse as a result we understand. Deliberately neutral — the message
  // may well have been delivered, and a hard "failed" here would push the
  // visitor into sending a duplicate. Do not overclaim in either direction.
  const UNCONFIRMED_MESSAGE =
    'Não conseguimos confirmar o envio da tua mensagem. Aguarda um momento e ' +
    'tenta novamente. Se o problema persistir, ' +
    'escreve-nos para geral@flowspace.pt.';

  // One message per error code Code.gs can return. Reading these at all is
  // only possible because the response is no longer opaque.
  const ERROR_MESSAGES = {
    rate_limited:
      'Recebemos demasiados pedidos neste momento. Tenta novamente dentro de ' +
      'alguns minutos ou escreve-nos para geral@flowspace.pt.',
    invalid_email:
      'O email indicado não foi aceite. Confirma o endereço e tenta novamente.',
    invalid_option:
      'A especialidade ou o interesse selecionado não é válido. Recarrega a ' +
      'página e volta a escolher uma das opções da lista.',
    missing_fields:
      'Faltam dados obrigatórios. Preenche o nome, o email, a especialidade e ' +
      'o interesse.',
    send_failed:
      'A mensagem não pôde ser entregue por email. ' + CONTACT_FALLBACK,
    invalid_payload:
      'O pedido não foi aceite. Recarrega a página e tenta novamente.',
    field_too_long:
      'Um dos campos é demasiado longo. Encurta a mensagem e tenta novamente.',
    stale_or_future_timestamp:
      'O formulário esteve aberto demasiado tempo. Recarrega a página e envia ' +
      'novamente.',
  };

  const form = document.getElementById('contactForm');
  if (!form) return;

  const successBanner = document.getElementById('formSuccess');
  const errorBanner = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const honeypot = document.getElementById('assunto2');

  let lastSubmitTime = 0;
  let successTimer = null;

  /**
   * The deployed URL is pasted in by hand (see the runbook), so it can be left
   * as the placeholder, mistyped, or pointed at the wrong path on the right
   * host. Any of those must be treated as unconfigured and never reach
   * fetch(): a relative or wrong URL still *fulfills* the promise (only
   * network-level failures reject), so the submit path would otherwise run
   * against a 404 or an HTML error page.
   */
  function isConfiguredUrl(url) {
    if (typeof url !== 'string' || url === PLACEHOLDER_URL) return false;
    return WEB_APP_URL_PATTERN.test(url);
  }

  const isConfigured = isConfiguredUrl(APPS_SCRIPT_URL);

  function clearFieldErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (el) {
      el.classList.remove('is-visible');
      const control = form.elements[el.getAttribute('data-error-for')];
      if (control) control.setAttribute('aria-invalid', 'false');
    });
  }

  function showFieldError(name) {
    const el = form.querySelector('[data-error-for="' + name + '"]');
    if (!el) return;
    el.classList.add('is-visible');
    const control = form.elements[name];
    if (control) control.setAttribute('aria-invalid', 'true');
  }

  function hideBanners() {
    successBanner.classList.remove('is-visible');
    errorBanner.classList.remove('is-visible');
  }

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('is-visible');
  }

  function showSuccess() {
    successBanner.classList.add('is-visible');
    if (successTimer) clearTimeout(successTimer);
    successTimer = setTimeout(function () {
      successBanner.classList.remove('is-visible');
    }, 6000);
  }

  function validate(values) {
    clearFieldErrors();
    let valid = true;

    if (!values.nome) {
      showFieldError('nome');
      valid = false;
    }
    if (!values.email || !EMAIL_REGEX.test(values.email)) {
      showFieldError('email');
      valid = false;
    }
    if (ALLOWED_ESPECIALIDADE.indexOf(values.especialidade) === -1) {
      showFieldError('especialidade');
      valid = false;
    }
    if (ALLOWED_INTERESSE.indexOf(values.interesse) === -1) {
      showFieldError('interesse');
      valid = false;
    }

    return valid;
  }

  /**
   * POST the submission and read the answer back.
   *
   * @return {Promise<{outcome: 'success'|'error'|'unconfirmed', code?: string}>}
   *   'success' only when the body was read, parsed, and said so.
   */
  async function send(values) {
    let response;
    try {
      response = await fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        // text/plain keeps this a CORS "simple request" so no preflight is
        // sent — Apps Script cannot answer an OPTIONS preflight. The body is
        // still JSON; Code.gs parses e.postData.contents either way.
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(values),
      });
    } catch (err) {
      // Offline, DNS failure, or CORS genuinely blocked the read. The request
      // may still have reached Apps Script and sent the mail, so we cannot
      // claim failure any more than we can claim success.
      console.error('flowspace-site: contact form request failed:', err);
      return { outcome: 'unconfirmed' };
    }

    let payload;
    try {
      payload = JSON.parse(await response.text());
    } catch (err) {
      console.error(
        'flowspace-site: could not read the contact form response (status ' +
          response.status +
          '):',
        err
      );
      return { outcome: 'unconfirmed' };
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { outcome: 'unconfirmed' };
    }
    if (payload.result === 'success') {
      return { outcome: 'success' };
    }
    if (payload.result === 'error') {
      return { outcome: 'error', code: String(payload.error || '') };
    }
    // A readable body we do not understand — an Apps Script HTML error page
    // would not have parsed at all, but a future/edited Code.gs might return
    // something else. Do not guess success.
    return { outcome: 'unconfirmed' };
  }

  // Fail loudly at load rather than only on submit: a visitor who can see the
  // form should not be able to fill it in and be told it worked.
  if (!isConfigured) {
    console.error(
      'flowspace-site: APPS_SCRIPT_URL is not configured (expected a deployed ' +
        'Web App URL of the form ' +
        'https://script.google.com/macros/s/<deployment-id>/exec). The contact ' +
        'form is disabled until it is set. See "Apps Script deploy runbook" in ' +
        'flowspace-site/README.md.'
    );
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    showError(UNAVAILABLE_MESSAGE);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();

    if (!isConfigured) {
      hideBanners();
      showError(UNAVAILABLE_MESSAGE);
      return;
    }

    hideBanners();

    // Honeypot: real visitors never see or fill this field. If it's
    // non-empty, silently pretend nothing happened — no network call, no
    // error, no success banner. This mirrors the server-side honeypot check
    // in apps-script/Code.gs so bots that skip JS entirely still get caught.
    if (honeypot && honeypot.value) {
      return;
    }

    const now = Date.now();
    if (now - lastSubmitTime < SUBMIT_COOLDOWN_MS) {
      showError('Aguarda alguns segundos antes de submeter novamente.');
      return;
    }

    const values = {
      nome: form.nome.value.trim(),
      email: form.email.value.trim(),
      especialidade: form.especialidade.value,
      interesse: form.interesse.value,
      mensagem: form.mensagem.value.trim(),
      timestamp: new Date().toISOString(),
    };

    if (!validate(values)) {
      return;
    }

    lastSubmitTime = now;
    submitBtn.disabled = true;
    submitBtn.textContent = 'A enviar...';

    try {
      const result = await send(values);

      if (result.outcome === 'success') {
        showSuccess();
        form.reset();
        clearFieldErrors();
      } else if (result.outcome === 'error') {
        // Keep the entered values: every one of these is either retryable or
        // correctable, and clearing the form would lose the visitor's text.
        showError(ERROR_MESSAGES[result.code] || UNCONFIRMED_MESSAGE);
      } else {
        showError(UNCONFIRMED_MESSAGE);
      }
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar mensagem';
    }
  });
})();
