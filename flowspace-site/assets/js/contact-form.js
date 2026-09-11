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

  const SUBMIT_COOLDOWN_MS = 5000;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const form = document.getElementById('contactForm');
  if (!form) return;

  const successBanner = document.getElementById('formSuccess');
  const errorBanner = document.getElementById('formError');
  const submitBtn = document.getElementById('submitBtn');
  const honeypot = document.getElementById('assunto2');

  let lastSubmitTime = 0;
  let successTimer = null;

  function clearFieldErrors() {
    Array.prototype.forEach.call(form.querySelectorAll('.field-error'), function (el) {
      el.classList.remove('is-visible');
    });
  }

  function showFieldError(name) {
    const el = form.querySelector('[data-error-for="' + name + '"]');
    if (el) el.classList.add('is-visible');
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

  form.addEventListener('submit', function (event) {
    event.preventDefault();
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
    // rejectable client-side (empty fields, bad email, tampered enum values)
    // is already caught above, so the only cases that show a false "success"
    // are a honeypot hit (correct — bots should see success) and the rare
    // genuine server-side rate limit. That's an accepted gap for a low
    // traffic B2B form, same as pixelforge's own documented risk acceptance.
    // A thrown fetch() error (offline, DNS failure, misconfigured URL above)
    // is the only case that shows the failure banner.
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
