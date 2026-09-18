/**
 * S27: regression tests for apps-script/Code.gs, the only enforcement point of
 * the public contact form.
 *
 * Nothing here touches the network or the deployed script. Code.gs is loaded
 * into a fresh VM sandbox with in-memory fakes of the Google services it uses,
 * and doPost() is called directly. Run with:
 *
 *     node --test flowspace-site/tests/code-gs.test.mjs
 *
 * No package is needed: node:test, node:vm and node:crypto ship with Node.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'apps-script', 'Code.gs'),
  'utf8'
);
const RECIPIENT = 'geral@flowspace.pt';

// Built from code points so this file holds no raw or escaped control character.
const char = (codePoint) => String.fromCodePoint(codePoint);
const CR = char(13);
const LF = char(10);
const CONTROL = { CR, LF, TAB: char(9), NUL: char(0), DEL: char(127) };
const OTHER_CONTROL = [0, 7, 11, 27, 127].map(char);
const UNICODE_SPACES = [0x2028, 0x2029, 0xa0, 0x20].map(char);
const ZERO_WIDTH_SPACE = char(0x200b);
const hasLineBreak = (text) => text.includes(CR) || text.includes(LF);

/** A fresh script instance with empty cache, properties and outbox. */
function loadScript({ mailThrows = false, lockThrows = false } = {}) {
  const sent = [];
  const cache = new Map();
  const properties = {};
  const sandbox = {
    MailApp: {
      sendEmail(options) {
        if (mailThrows) throw new Error('Service invoked too many times for one day: email.');
        sent.push(options);
      },
    },
    CacheService: {
      getScriptCache: () => ({
        get: (key) => (cache.has(key) ? cache.get(key) : null),
        put: (key, value) => cache.set(key, value),
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => ({ ...properties }),
        setProperties: (update) => Object.assign(properties, update),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        waitLock() {
          if (lockThrows) throw new Error('Lock timeout');
        },
        releaseLock() {},
      }),
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (text) => ({
        text,
        setMimeType(mime) {
          this.mime = mime;
          return this;
        },
      }),
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      // Apps Script returns signed bytes; mirror that so the hex helper is exercised.
      computeDigest: (_algorithm, value) =>
        Array.from(createHash('sha256').update(value, 'utf8').digest()).map((b) =>
          b > 127 ? b - 256 : b
        ),
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(SOURCE, context, { filename: 'Code.gs' });
  const doPost = vm.runInContext('doPost', context);
  return {
    sent,
    properties,
    config: vm.runInContext('CONFIG', context),
    assertSendOptions: vm.runInContext('assertSendOptions', context),
    postRaw: (contents) => JSON.parse(doPost({ postData: { contents } }).text),
    post: (body) => JSON.parse(doPost({ postData: { contents: JSON.stringify(body) } }).text),
    call: (event) => JSON.parse(doPost(event).text),
  };
}

function valid(overrides = {}) {
  return {
    nome: 'Ana Silva',
    email: 'Ana.Silva@Example.com',
    especialidade: 'Psicologia',
    interesse: 'Reserva avulsa',
    mensagem: ['Olá,', 'queria saber mais.', '', 'Obrigada.'].join(LF),
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

const ERROR = (code) => ({ result: 'error', error: code });

test('control: a valid enquiry sends exactly one plain-text mail to the business', () => {
  const script = loadScript();
  assert.equal(script.post(valid()).result, 'success');
  assert.equal(script.sent.length, 1);
  const mail = script.sent[0];
  assert.deepEqual(Object.keys(mail).sort(), ['body', 'replyTo', 'subject', 'to']);
  assert.equal(mail.to, RECIPIENT);
  assert.equal(mail.replyTo, 'ana.silva@example.com');
  assert.equal(mail.subject, 'Novo contacto FlowSpace — Psicologia / Reserva avulsa');
  assert.ok(mail.body.includes('Nome: Ana Silva'));
  assert.ok(mail.body.includes('queria saber mais.'));
});

test('a name carrying CRLF and a Bcc header is refused, mails nothing and spends no slot', () => {
  const script = loadScript();
  const answer = script.post(valid({ nome: `Ana${CR}${LF}Bcc: vitima@exemplo.com` }));
  assert.deepEqual(answer, ERROR('invalid_characters'));
  assert.equal(script.sent.length, 0);
  assert.deepEqual(script.properties, {});
});

for (const field of ['nome', 'email', 'especialidade', 'interesse']) {
  for (const [label, control] of Object.entries(CONTROL)) {
    test(`${label} in ${field} is refused outright, never stripped`, () => {
      const script = loadScript();
      const value = valid()[field];
      const placements = [control + value, value + control, value.slice(0, 2) + control + value.slice(2)];
      for (const hostile of placements) {
        assert.deepEqual(script.post(valid({ [field]: hostile })), ERROR('invalid_characters'));
      }
      assert.equal(script.sent.length, 0);
      assert.deepEqual(script.properties, {});
    });
  }
}

test('line breaks in the message reach the body only, never a header', () => {
  const script = loadScript();
  const mensagem = ['linha 1', 'Bcc: vitima@exemplo.com', 'Subject: outro'].join(CR + LF);
  assert.equal(script.post(valid({ mensagem })).result, 'success');
  const mail = script.sent[0];
  assert.ok(mail.body.includes('Bcc: vitima@exemplo.com'));
  for (const header of [mail.to, mail.replyTo, mail.subject]) {
    assert.equal(hasLineBreak(header), false);
    assert.equal(header.includes('vitima'), false);
  }
});

test('any other control character in the message is refused', () => {
  const script = loadScript();
  for (const control of OTHER_CONTROL) {
    assert.deepEqual(script.post(valid({ mensagem: `olá${control}` })), ERROR('invalid_characters'));
  }
  assert.equal(script.sent.length, 0);
});

test('Unicode line separators and spaces cannot ride in the reply address', () => {
  const script = loadScript();
  for (const space of UNICODE_SPACES) {
    const answer = script.post(valid({ email: `ana${space}@example.com` }));
    assert.equal(answer.result, 'error', `U+${space.codePointAt(0).toString(16)}`);
  }
  assert.equal(script.sent.length, 0);
});

test('the recipient is never taken from the request', () => {
  const script = loadScript();
  const hostile = valid({
    to: 'atacante@exemplo.com',
    cc: 'atacante@exemplo.com',
    bcc: 'atacante@exemplo.com',
    from: 'ceo@flowspace.pt',
    name: 'FlowSpace',
    htmlBody: '<img src=x onerror=alert(1)>',
    TO_EMAIL: 'atacante@exemplo.com',
    subject: 'Fatura em atraso',
  });
  assert.equal(script.post(hostile).result, 'success');
  const mail = script.sent[0];
  assert.equal(mail.to, RECIPIENT);
  assert.deepEqual(Object.keys(mail).sort(), ['body', 'replyTo', 'subject', 'to']);
  assert.doesNotMatch(JSON.stringify(mail), /atacante|Fatura|onerror/);
});

test('the subject is built from the allow-listed options only', () => {
  const { config } = loadScript();
  for (const especialidade of config.ALLOWED_ESPECIALIDADE) {
    for (const interesse of config.ALLOWED_INTERESSE) {
      const fresh = loadScript();
      const answer = fresh.post(valid({ especialidade, interesse, nome: 'URGENTE: paga já' }));
      assert.equal(answer.result, 'success');
      assert.equal(fresh.sent[0].subject, `Novo contacto FlowSpace — ${especialidade} / ${interesse}`);
    }
  }
  const script = loadScript();
  assert.deepEqual(script.post(valid({ especialidade: 'Psicologia — URGENTE' })), ERROR('invalid_option'));
  assert.deepEqual(
    script.post(valid({ interesse: `Reserva avulsa${ZERO_WIDTH_SPACE}` })),
    ERROR('invalid_option')
  );
  assert.equal(script.sent.length, 0);
});

test('length is judged on what was sent, before anything is stripped', () => {
  const script = loadScript();
  const { MAX_NOME_LENGTH, MAX_EMAIL_LENGTH, MAX_MENSAGEM_LENGTH } = script.config;
  const tooLong = [
    { nome: 'a'.repeat(MAX_NOME_LENGTH + 1) },
    { nome: '<'.repeat(MAX_NOME_LENGTH + 1) },
    { mensagem: 'a'.repeat(MAX_MENSAGEM_LENGTH + 1) },
    { email: `${'a'.repeat(MAX_EMAIL_LENGTH)}@example.com` },
  ];
  for (const overrides of tooLong) {
    assert.deepEqual(script.post(valid(overrides)), ERROR('field_too_long'));
  }
  assert.equal(script.sent.length, 0);
  assert.equal(loadScript().post(valid({ nome: 'a'.repeat(MAX_NOME_LENGTH) })).result, 'success');
});

test('a name that is empty once sanitised is a missing field, not a blank enquiry', () => {
  const script = loadScript();
  assert.deepEqual(script.post(valid({ nome: '<>' })), ERROR('missing_fields'));
  assert.deepEqual(script.post(valid({ nome: '   ' })), ERROR('missing_fields'));
  assert.equal(script.sent.length, 0);
  assert.deepEqual(script.properties, {});
});

test('angle brackets never reach the mail body', () => {
  const script = loadScript();
  const answer = script.post(
    valid({ nome: 'Ana <b>Silva</b>', mensagem: '<script>alert(1)</script>' })
  );
  assert.equal(answer.result, 'success');
  assert.doesNotMatch(script.sent[0].body, /[<>]/);
});

test('bodies that are not a JSON object are refused without throwing', () => {
  const script = loadScript();
  for (const event of [undefined, null, {}, { postData: {} }, { postData: { contents: 42 } }]) {
    assert.deepEqual(script.call(event), ERROR('invalid_payload'));
  }
  for (const contents of ['', 'not json', 'null', '"texto"', '3', '[]', 'true']) {
    assert.deepEqual(script.postRaw(contents), ERROR('invalid_payload'));
  }
  assert.equal(script.sent.length, 0);
});

test('fields that are not strings count as missing, not as text', () => {
  const script = loadScript();
  for (const value of [42, true, ['Ana'], { toString: 'Ana' }, null]) {
    assert.deepEqual(script.post(valid({ nome: value })), ERROR('missing_fields'));
    assert.deepEqual(script.post(valid({ email: value })), ERROR('missing_fields'));
  }
  assert.deepEqual(script.post(valid({ timestamp: 1700000000000 })), ERROR('missing_fields'));
  assert.equal(script.sent.length, 0);
});

test('the honeypot answers success, mails nothing and spends no slot', () => {
  const script = loadScript();
  const answer = script.post(valid({ [script.config.HONEYPOT_FIELD]: 'comprar agora' }));
  assert.equal(answer.result, 'success');
  assert.equal(script.sent.length, 0);
  assert.deepEqual(script.properties, {});
});

test('a stale or future timestamp is refused before a slot is spent', () => {
  const script = loadScript();
  const now = Date.now();
  const stale = new Date(now - script.config.TIMESTAMP_MAX_AGE_MS - 60_000).toISOString();
  const future = new Date(now + script.config.TIMESTAMP_MAX_FUTURE_MS + 60_000).toISOString();
  for (const timestamp of [stale, future, 'ontem', '0000-00-00']) {
    assert.deepEqual(script.post(valid({ timestamp })), ERROR('stale_or_future_timestamp'));
  }
  assert.equal(script.sent.length, 0);
  assert.deepEqual(script.properties, {});
});

test('one address gets one send per window, whatever its case', () => {
  const script = loadScript();
  assert.equal(script.post(valid({ email: 'ana@example.com' })).result, 'success');
  assert.deepEqual(script.post(valid({ email: 'ana@example.com' })), ERROR('rate_limited'));
  assert.deepEqual(script.post(valid({ email: 'ANA@EXAMPLE.COM' })), ERROR('rate_limited'));
  assert.equal(script.sent.length, 1);
});

test('the global hourly cap holds however many addresses are used', () => {
  const script = loadScript();
  const cap = script.config.GLOBAL_HOURLY_LIMIT;
  for (let i = 0; i < cap; i += 1) {
    assert.equal(script.post(valid({ email: `bot${i}@example.com` })).result, 'success', `send ${i}`);
  }
  assert.deepEqual(script.post(valid({ email: 'mais.um@example.com' })), ERROR('rate_limited'));
  assert.equal(script.sent.length, cap);
});

test('a mail provider failure and a busy lock are reported, never as success', () => {
  assert.deepEqual(loadScript({ mailThrows: true }).post(valid()), ERROR('send_failed'));
  const busy = loadScript({ lockThrows: true });
  assert.deepEqual(busy.post(valid()), ERROR('rate_limited'));
  assert.equal(busy.sent.length, 0);
});

test('the last check before sending fails closed', () => {
  const { assertSendOptions } = loadScript();
  const good = { to: RECIPIENT, replyTo: 'ana@example.com', subject: 'Novo contacto', body: 'x' };
  assert.equal(assertSendOptions(good), true);
  assert.equal(assertSendOptions({ ...good, to: 'atacante@exemplo.com' }), false);
  assert.equal(assertSendOptions({ ...good, to: `${RECIPIENT},atacante@exemplo.com` }), false);
  for (const option of ['cc', 'bcc', 'from', 'name', 'htmlBody', 'attachments', 'inlineImages']) {
    assert.equal(assertSendOptions({ ...good, [option]: 'x' }), false, option);
  }
  assert.equal(assertSendOptions({ ...good, subject: `a${CR}${LF}Bcc: x@y.z` }), false);
  assert.equal(assertSendOptions({ ...good, replyTo: `ana@example.com${LF}Bcc: x@y.z` }), false);
  assert.equal(assertSendOptions({ ...good, replyTo: 'not an address' }), false);
  assert.equal(assertSendOptions(null), false);
});
