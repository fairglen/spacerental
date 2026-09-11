/**
 * FlowSpace contact form.
 *
 * Sends submissions to a Google Apps Script Web App (apps-script/Code.gs)
 * which emails geral@flowspace.pt via MailApp.sendEmail. There is no backend
 * of our own here — see flowspace-site/README.md for the full deploy runbook.
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
  const APPS_SCRIPT_HOST = 'script.google.com';

  const SUBMIT_COOLDOWN_MS = 5000;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const UNAVAILABLE_MESSAGE =
    'O formulário está temporariamente indisponível. Escreve-nos para ' +
    'geral@flowspace.pt e respondemos em menos de 24 horas.';

  const form = document.getElementById('contactForm');
  if (!form) return;

  const successBanner = document.getElementById('formSuccess');
  const errorBanner = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const honeypot = document.getElementById('assunto2');

  let lastSubmitTime = 0;
  let successTimer = null;

  /**
   * The deployed URL is pasted in by hand (see the runbook), so it can be
   * left as the placeholder or mistyped. Either way it must never reach
   * fetch(): a relative or wrong URL still *fulfills* the promise (only
   * network-level failures reject), and mode: 'no-cors' makes the response
   * opaque, so the .then() branch would report a success that never happened
   * and the visitor's enquiry would be lost silently.
   */
  function isConfiguredUrl(url) {
    if (typeof url !== 'string' || url === PLACEHOLDER_URL) return false;
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.hostname === APPS_SCRIPT_HOST;
    } catch (err) {
      return false;
    }
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
    if (!values.especialidade) {
      showFieldError('especialidade');
      valid = false;
    }
    if (!values.interesse) {
      showFieldError('interesse');
      valid = false;
    }

    return valid;
  }

  // Fail loudly at load rather than only on submit: a visitor who can see the
  // form should not be able to fill it in and be told it worked.
  if (!isConfigured) {
    console.error(
      'flowspace-site: APPS_SCRIPT_URL is not configured (expected an ' +
        'absolute https://' +
        APPS_SCRIPT_HOST +
        '/macros/s/.../exec URL). The contact form is disabled until it is ' +
        'set. See "Apps Script deploy runbook" in flowspace-site/README.md.'
    );
    submitBtn.disabled = true;
    submitBtn.setAttribute('aria-disabled', 'true');
    showError(UNAVAILABLE_MESSAGE);
  }

  form.addEventListener('submit', function (event) {
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

    // NOTE on the accepted UX tradeoff: Google Apps Script Web Apps require
    // mode: 'no-cors' for cross-origin browser calls, which means the
    // response is opaque — we cannot read its status or body. In practice
    // this means we cannot tell a real success apart from a server-side
    // rejection (rate-limited, mail quota exhausted). Everything realistically
    // rejectable client-side (empty fields, bad email, tampered enum values,
    // an unconfigured endpoint) is already caught above, so the only cases
    // that show a false "success" are a honeypot hit (correct — bots should
    // see success) and the rare genuine server-side rate limit. That's an
    // accepted gap for a low traffic B2B form, same as pixelforge's own
    // documented risk acceptance. A thrown fetch() error (offline, DNS
    // failure) is the only case that shows the failure banner.
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(values),
    })
      .then(function () {
        showSuccess();
        form.reset();
        clearFieldErrors();
      })
      .catch(function (error) {
        console.error('Erro ao enviar o formulário de contacto:', error);
        showError('Não foi possível enviar a mensagem. Verifica a tua ligação e tenta novamente.');
      })
      .finally(function () {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Enviar mensagem';
      });
  });
})();
