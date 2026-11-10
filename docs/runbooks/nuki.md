# Smart-lock access with Nuki (L01)

How FlowSpace gives each customer a door PIN and reads the lock's log back as
an audit trail, and everything the operator has to do to run it. The software
is in `backend/app/locks.py` (the Nuki boundary), `backend/app/access.py` (the
bookkeeping and the reconciliation pass) and `backend/app/holds.py` (the pass
runs in the sweeper slot). This runbook is the operator's side.

**The model.** One PIN per customer, not per booking, issued on their first
confirmed booking (every checkout path). No time windows on the door —
*freedom at the door, audit afterwards*: compliance is judged against the
customer's bookings from the lock's own log (PR B). A customer idle for
`ACCESS_DORMANCY_DAYS` loses the slot on the lock; the PIN stays in our
database and is re-registered on their next confirmed booking, unchanged.

The PIN is encrypted at rest (`ACCESS_PIN_KEY`, Fernet) and never logged,
never shown to the operator — only to the customer, on their dashboard.

---

## 1. Hardware and network

- Smart Lock mounted and calibrated in the Nuki app; **Keypad paired** (the
  app shows "Keypad" under the lock); **Door Sensor paired and calibrated**
  (the app shows the door open/closed correctly).
- The lock reachable from the Nuki cloud: a 4th-gen (Pro) lock on Wi-Fi, or a
  Nuki Bridge within Bluetooth range and on Wi-Fi. Test: with your phone's
  Wi-Fi and Bluetooth off, the Nuki app still shows and controls the lock.
- Nuki app → lock → Features & configuration: **Auto lock on** (locks itself
  a few minutes after unlocking, so a customer cannot leave it open).
- Note the lock's **name**; match it to its id below.

## 2. Nuki Web account and API token

- Open https://web.nuki.io, sign in, confirm the lock appears.
- Menu → **API** → **Generate API token**. Scopes: smartlock read/write
  (actions), smartlock.auth (manage codes), smartlock.log (read the log).
  Name it `flowspace-prod`. It is shown once — keep it in your password
  manager, never in the repo, a PR or a comment.
- Find the smartlock id from your laptop:
  ```bash
  export NUKI_TOKEN='…'
  curl -s -H "Authorization: Bearer $NUKI_TOKEN" https://api.nuki.io/smartlock \
    | python3 -c "import json,sys;[print(d['smartlockId'],d['name'],'doorState=',d['state'].get('doorState'),'keypad=',d.get('keypadPaired') or d.get('keypad2Paired')) for d in json.load(sys.stdin)]"
  ```
  `doorState` 2 = closed, 3 = open.

## 3. Verify the log mapping (ten-minute spike)

The exact `action`/`trigger` enum lives only in the live Nuki Swagger
("Model → SmartlockLog" at https://api.nuki.io/); `backend/app/locks.py`
encodes the values this ingestion knows and classifies anything else as
`unknown` without crashing (**DECISION L01**). Confirm the ones we rely on:

```bash
ID=<smartlockId>
# a test PIN: 6 digits, 1-9 only, not starting with "12"
curl -s -o /dev/null -w "%{http_code}\n" -X PUT -H "Authorization: Bearer $NUKI_TOKEN" \
  -H "Content-Type: application/json" -d '{"name":"fs-spike","type":13,"code":345678}' https://api.nuki.io/smartlock/$ID/auth
sleep 20
curl -s -H "Authorization: Bearer $NUKI_TOKEN" https://api.nuki.io/smartlock/$ID/auth \
  | python3 -c "import json,sys;[print(a['id'],a['name'],a.get('type'),a.get('enabled')) for a in json.load(sys.stdin)]"
# type 345678 ✓ on the Keypad, open and close the door by hand, press the lock key, then:
curl -s -H "Authorization: Bearer $NUKI_TOKEN" "https://api.nuki.io/smartlock/$ID/log?limit=10" | python3 -m json.tool
# delete the test PIN:
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE -H "Authorization: Bearer $NUKI_TOKEN" https://api.nuki.io/smartlock/$ID/auth/<id>
```

If a keypad unlock, a door open/close (actions 240/241) or the lock key do not
map to `keypad_unlock` / `door_open` / `door_close` / `lock`, adjust the named
constants at the top of `backend/app/locks.py`. There is also an opt-in
contract test: `NUKI_LIVE_TEST=1 NUKI_API_TOKEN=… NUKI_LIVE_DEVICE_ID=… \
python -m pytest backend/tests/test_nuki_live.py` (never runs in CI).

## 4. Policy (defaults in brackets; change in the `.env`)

| Setting | Default | Meaning |
|---|---|---|
| `ACCESS_EARLY_MINUTES` | 15 | early arrival tolerated |
| `ACCESS_OVERSTAY_MINUTES` | 15 | overstay tolerated |
| `ACCESS_DORMANCY_DAYS` | 90 | code leaves the lock after no booking for this long |
| `ACCESS_EVENT_RETENTION_DAYS` | 90 | raw lock events kept (verdicts stay) |
| `ACCESS_ALERT_EMAIL` | empty = off | alert on a lock entry with no booking (PR B) |

## 5. Legal text (before the first real customer gets a code)

Add to the terms and the privacy notice, in your words, roughly:

> "O acesso ao espaço faz-se com um código pessoal no teclado da porta. As
> utilizações do código e a abertura/fecho da porta são registadas e
> conservadas durante 90 dias, para verificar a conformidade com as reservas e
> para segurança do espaço. O código é pessoal e intransmissível."

Formal register. Have a lawyer review it if you want.

## 6. Production configuration

- Create a hidden **test space** in `/admin` (inactive / not listed); note its
  id (from the URL).
- Generate the PIN key: `openssl rand -base64 32` (or
  `python -c "from cryptography.fernet import Fernet;print(Fernet.generate_key().decode())"`).
- In `.env.production` (the live copy is the SSM SecureString
  `/spacerental/prod/env`):
  ```
  LOCK_PROVIDER=nuki
  NUKI_API_TOKEN=<token>
  NUKI_DEVICE_ID_MAP={"<test space id>":"<smartlockId>"}
  ACCESS_PIN_KEY=<base64 key>
  ```
  `NUKI_DEVICE_ID_MAP` is **space id → smartlock id**; `"*"` is one lock for
  every space. The app refuses to start with `LOCK_PROVIDER=nuki` and any of
  the token, map or key missing.
  ```bash
  aws ssm put-parameter --region eu-west-1 --name /spacerental/prod/env \
    --type SecureString --value file://.env.production --overwrite
  gh workflow run deploy.yml --ref main -R fairglen/spacerental
  ```
- Watch the deploy; `aws logs tail /spacerental/prod --since 5m` should show no
  startup refusal and no token/PIN in the lines.

**Timing.** Issuance is not inline with checkout — a Nuki outage never fails a
payment. The reconciliation pass (every `HOLD_SWEEP_INTERVAL_SECONDS`, default
60 s, one per deployment under the N01 advisory lock) issues pending PINs,
deletes revoked ones, retries with backoff, and takes idle customers off the
lock. The dashboard shows "a ativar" until the lock confirms, then the PIN.

## 7. Real-world test (tick each; paste results into the PR)

1. Book the test space with a test customer; pay; the dashboard shows "a
   ativar" then the code within a minute; the Keypad accepts it.
2. Enter on time → the booking shows "Entrou HH:MM", verdict on time (PR B).
3. Enter 20 min before → early (20 min). Enter with no booking → "sem reserva".
4. Leave, press the lock key → "Saiu ~HH:MM (estimado)".
5. "Pedir um código novo" (dashboard) → old code refused, new one accepted.
6. Admin → revoke → refused at the door. Re-activate → accepted.
7. Anonymise the test customer → the authorisation disappears in web.nuki.io.
8. Unplug the Bridge; book a third customer → "a ativar" with a retry; plug in
   → "ativo".
9. Restart the backend mid-test → nothing lost (the state is in Postgres).
10. `aws logs tail` over the whole test: no token, no PIN.

## 8. The real space

- Install the hardware on the entrance; auto lock on; test from outside.
- Map the real space: `NUKI_DEVICE_ID_MAP={"<real space id>":"<id>"}` (drop the
  test space), `put-parameter`, deploy. Run section 7 on site.
- Existing customers get their code on their next confirmed booking.

## 9. Operations

- **Battery:** the Nuki app warns; `batteryCritical` surfaces on the device
  state. Keep spares at the space.
- **Nuki down:** codes already on the lock keep working; new codes wait in "a
  ativar" and retry; the operator can open the door from `/admin`
  (`POST /admin/spaces/{id}/open-door`) when Nuki is back, or use the key.
- **A customer shares a code:** rotate it from the admin customer page.
- **Lock full (100–200 codes):** dormancy frees slots automatically; lower
  `ACCESS_DORMANCY_DAYS` if needed.
- **Token leaked/rotated:** new token → `put-parameter` → deploy.
