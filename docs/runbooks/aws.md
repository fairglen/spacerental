# FlowSpace on AWS — the owner's runbook

What this is: every step from an empty AWS account to `https://app.flowspace.pt`
serving customers, and what to do afterwards. Each step is a command you
run; nothing here is done for you by a merge until you say so with two
repository variables (`INFRA_ENABLED`, `DEPLOY_ENABLED`). Region
**eu-west-1** (Ireland) throughout; one arm64 EC2 instance, one RDS
PostgreSQL, one S3 bucket for backups, two ECR repositories (E-series,
`TODO.md`).

What runs where, once it is up:

```
browser ──https──▶ Caddy :443 ──▶ frontend :3000 (Next.js) ──/backend/*──▶ backend :8000 (FastAPI)
                   (Let's Encrypt)                                              │
                                                                 RDS PostgreSQL 18 (private)
/srv/media (EBS 20 GB) = photos + private invoice PDFs   ·   S3 backups (dumps/, media/, deploy/)
CloudWatch: logs (/spacerental/prod), disk/memory metrics, alarms → your email · Budget USD 55
```

Files: `docker-compose.prod.yml` (+ `docker-compose.prod.awslogs.yml`),
`deploy/` (Caddyfile, `deploy.sh`, `backup.sh`, `restore.sh`, the backup
timer, `cloud-init.yaml`), `.env.production.example`, `infra/bootstrap`,
`infra/prod`, `.github/workflows/infra.yml`, `.github/workflows/deploy.yml`.

Tools on your laptop: `aws` (CLI v2), `terraform` ≥ 1.10, `gh`, `jq`,
`git`, the AWS Session Manager plugin for `aws ssm start-session`
(`brew install --cask session-manager-plugin`).

Cost: about **36 €/month** at list prices — EC2 t4g.small ≈ 12 $, its two
20 GB gp3 volumes ≈ 3.5 $, the Elastic IP ≈ 3.7 $, RDS db.t4g.micro ≈ 12.5 $
+ 20 GB ≈ 2.3 $, S3/CloudWatch/transfer ≈ 3 $ — within the credits. The
Budget alarm fires at 80 % and 100 % of 55 $.

---

## Phase 1 — the account

### 1.0 An account from "Sign up for AWS (new)"

The 2026 sign-up does not hand you one account: it builds a small AWS
Organization around a *project* — a **management account**
(`918441610244`), an **Identity delegated-admin account** (IAM Identity
Center lives there) and the **workload account** the app runs in
(`628376152856`, the one every other step of this runbook means) — and
AWS manages that organization's service control policies
([the policies, verbatim](https://docs.aws.amazon.com/accounts/latest/reference/scps-and-rcps-for-projects.html)).
Four things cost time the first time:

1. **Activate advanced features** (AWS Settings → Advanced features)
   before anything else. Until then the project SCP denies `account:*`,
   `billing:*`, the notification APIs and `iam:PutAccountProperties`;
   activating removes that policy and makes Organizations, Identity Center
   and the SCPs yours to edit. `BlockOrgEscape` (no `CloseAccount`, no
   `LeaveOrganization`, no second Identity Center instance) stays on the
   root for good — expected.
2. **Regions: the `RegionFloor` statement.** The region SCP denies every
   request whose region is not `us-east-1`, `us-west-2` or the one region
   picked at sign-up. If that was not **eu-west-1**, every command below
   fails with an explicit-deny `AccessDenied` until `eu-west-1` is added to
   the `aws:RequestedRegion` list of that statement's `StringNotEquals`
   condition. Leave `us-east-1` in: CloudFront's certificate must live
   there (E18).
3. **SCPs are edited from the management account only** (`918441610244`:
   Organizations → Policies → Service control policies). The workload and
   Identity accounts can list them, never change them, and the console
   shows no edit button there. Sign in to the management account through
   the Identity Center portal (or its root user, with MFA), not with an
   IAM user created for the purpose.
4. **CloudShell opens in the Identity delegated-admin account** when you
   launch it from the console the Identity Center portal lands you in:
   `aws sts get-caller-identity` there does not print `628376152856`, and
   nothing from this runbook works. Use the laptop CLI with the
   `spacerental` profile (1.3) or switch the console to the workload
   account first.

### 1.1 The workload account

1. **Root user:** enable MFA (IAM → root → Security credentials), then stop
   using it.
2. **IAM Identity Center** (one region, eu-west-1; already enabled in the
   Identity account by the new sign-up — then only the user and the
   assignment are yours to make): create a user for yourself, a permission
   set `AdministratorAccess`, assign it to the workload account. Sign-in
   portal URL and your user come from the console.
3. **The CLI as that user:**

   ```bash
   aws configure sso --profile spacerental
   # SSO start URL: <your portal URL> · region: eu-west-1 · account: the one · role: AdministratorAccess
   export AWS_PROFILE=spacerental
   aws sts get-caller-identity          # prints the account id you will need below
   ```

4. **Budget:** Terraform creates one (Phase 2); nothing to do now.

## Phase 2 — the infrastructure (once from the laptop, then from GitHub)

### 2.1 Bootstrap: state bucket, GitHub OIDC provider, the three CI roles

```bash
cd infra/bootstrap
terraform init -upgrade              # also after every provider bump (.terraform.lock.hcl)
terraform apply                      # ≈ 10 resources; type yes
terraform output                     # state_bucket, plan_role_arn, apply_role_arn, deploy_role_arn
```

The state file of this module stays on your laptop
(`infra/bootstrap/terraform.tfstate`, gitignored): keep it — it is the only
thing that knows these resources. Everything else is in the S3 bucket it
created.

This module is applied from the laptop only, so a Dependabot bump of
`infra/bootstrap/.terraform.lock.hcl` (hashicorp/aws 6.70 in #133, for
example) changes nothing until you run `terraform init -upgrade` here
again; without `-upgrade`, `init` keeps the provider version already in
`.terraform/` and `plan` says nothing about it. `terraform plan` afterwards
must say "No changes".

### 2.2 GitHub: variables and the `production` environment

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
gh variable set AWS_ACCOUNT_ID --body "$ACCOUNT_ID"
gh variable set AWS_REGION --body eu-west-1
gh variable set APP_DOMAIN --body app.flowspace.pt

# The environment that gates every infrastructure apply: you review it.
OWNER_ID=$(gh api users/fairglen -q .id)
gh api -X PUT repos/fairglen/spacerental/environments/production \
  --input - <<JSON
{"reviewers": [{"type": "User", "id": $OWNER_ID}], "deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api -X POST repos/fairglen/spacerental/environments/production/deployment-branch-policies \
  -f name=main -f type=branch
```

(Or in Settings → Environments → New environment → `production` →
Required reviewers: fairglen; Deployment branches and tags: **Selected
branches and tags**, add `main`. Not "Protected branches only": `main` is
protected by a **ruleset**, which that option does not recognise, so a
job in the environment would be refused on `main`.)

**Verify it** — the reviewer is the whole control on `terraform apply`
(E05, E11); the API answer must list you under `required_reviewers`:

```bash
gh api repos/fairglen/spacerental/environments/production \
  --jq '.protection_rules[] | select(.type == "required_reviewers") | .reviewers[].reviewer.login'
# → fairglen
```

An empty answer means every merge touching `infra/**` applies unattended.
That is what happened on 2026-10-27/28: the environment existed without a
reviewer, and the first applies (`#136`, `#133`, `#134`) ran seconds after
their `validate` job, with nobody asked (D27). The proof that the gate is
back is a merge touching `infra/**` whose `apply (production)` job stops at
"Review deployments" (E17 was the first).

The second environment, `production-app`, is the deploy role's only
trusted subject (E10): every `deploy.yml` run happens in it. Create it
**without** reviewers — deploys stay continuous; a reviewer here is the one
switch that makes every deploy wait (Phase 5):

```bash
gh api -X PUT repos/fairglen/spacerental/environments/production-app \
  --input - <<'JSON'
{"deployment_branch_policy": {"protected_branches": false, "custom_branch_policies": true}}
JSON
gh api -X POST repos/fairglen/spacerental/environments/production-app/deployment-branch-policies \
  -f name=main -f type=branch
```

Then arm the infrastructure workflow:

```bash
gh variable set INFRA_ENABLED --body true
```

From now on a PR touching `infra/**` gets a `terraform plan` comment, and a
merge to `main` touching `infra/**` plans and waits for your approval before
applying. Dependabot's provider bumps get `validate` only (E12): their plan
happens on `main` after the merge, behind the same approval.

### 2.3 The first apply

```bash
gh workflow run infra.yml --ref main
gh run watch                          # or Actions → Infrastructure → the run
```

The `apply` job stops at **Review deployments** — read the plan in the job
before it (≈ 40 resources: the instance, its volumes and profile, the
security groups, RDS, the bucket, the two ECR repositories, the deploy
SSM document, the log group, alarms, DLM, the budget), then approve. If the
plan rejects PostgreSQL `18` for the region, set
`db_engine_version = "17"` in `infra/prod/variables.tf` (the app needs 16+)
and run again.

Read the outputs (either from the job's log, or locally — `init` only
connects to the state bucket; nothing is applied from the laptop):

```bash
cd infra/prod
terraform init -backend-config="bucket=spacerental-tfstate-$ACCOUNT_ID"
terraform output
# elastic_ip, instance_id, rds_endpoint, rds_secret_arn, backups_bucket,
# ecr_backend_url, ecr_frontend_url, log_group, ssm_session_command
```

### 2.4 The application's database role, then the production `.env` into SSM

The application never connects as the RDS master user: RDS rotates that
password every 7 days, so nothing may copy it (E09). Once, after the first
apply and before the first deploy, create the app role on the host — the
master URL is read **on the laptop** and pasted into the session; the host
never stores it:

```bash
# On the laptop: the master URL, from the secret RDS manages. The password
# is percent-encoded (`@uri`): RDS generates characters that break a URL.
MASTER_URL="postgresql://spacerental:$(aws secretsmanager get-secret-value \
  --secret-id "$(terraform -chdir=infra/prod output -raw rds_secret_arn)" \
  --query SecretString --output text | jq -r '.password | @uri')@$(terraform -chdir=infra/prod output -raw rds_endpoint)/spacerental"
echo "$MASTER_URL"      # copy it

aws ssm start-session --target "$(terraform -chdir=infra/prod output -raw instance_id)"
# on the host:
sudo /srv/spacerental/db-bootstrap.sh     # paste the URL at the prompt (not echoed)
```

It generates the app password, stores it in the secret
`spacerental/prod/db-app` (Terraform created the empty shell), creates the
role `spacerental_app`, hands it the database and checks it can connect.
Running it again changes nothing. From then on every deploy composes
`DATABASE_URL` from that secret — **do not put `DATABASE_URL` in the
`.env`**; `deploy.sh` refuses a file that carries one.

Then the `.env`:

```bash
cp .env.production.example .env.production      # gitignored
# Fill it in. Secrets:
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_urlsafe(48))"
echo "NEXTAUTH_SECRET=$(openssl rand -base64 48)"

aws ssm put-parameter --region eu-west-1 --name /spacerental/prod/env \
  --type SecureString --tier Advanced --value file://.env.production --overwrite
```

This command creates the parameter the first time and replaces it after
(Terraform does not manage it — E17: a Terraform-managed parameter had to
be read by every pull-request plan, and the plan role is denied exactly
that, E11). `--tier Advanced` is what allows the 8 KB a commented
template needs; the standard tier stops at 4 KB.

Keep `EMAIL_MODE=stub` and `STRIPE_MODE=stub` for the first deploy: the
backend logs a WARNING for each and nothing leaves the host. Every later
change to `.env.production` is this `put-parameter` again plus a deploy
(Phase 4).

### 2.5 DNS (yours; the only step outside AWS and GitHub)

Point `app.flowspace.pt` at the Elastic IP: one `A` record,
`app.flowspace.pt. A <elastic_ip>`. Caddy obtains the certificate on its own
once the name resolves.

### 2.6 Arm the deployer

```bash
gh variable set DEPLOY_ENABLED --body true
```

From now on every green `Checks` run on `main` builds the images, pushes
them to ECR and deploys them to the instance.

## Phase 3 — the first deploy and the first organisation

```bash
gh workflow run deploy.yml --ref main       # or merge anything to main
gh run watch
```

The job ends with `GET https://app.flowspace.pt/backend/health` → 200 (the
API's health route has no `/api/v1` prefix). Then create the organisation,
on the host, through Session Manager (no SSH, no key pair):

```bash
aws ssm start-session --target "$(terraform -chdir=infra/prod output -raw instance_id)"
# on the host:
sudo -i
cd /srv/spacerental
docker compose -f docker-compose.prod.yml -f docker-compose.prod.awslogs.yml exec backend \
  python -m app.bootstrap --name FlowSpace --slug flowspace \
    --admin-email geral@flowspace.pt --admin-name "FlowSpace"
```

It creates the organisation `flowspace` (the slug `CUSTOMER_ENROLLMENT_ORG_SLUG`
names), the space with the site's address and hours, the three rooms
(`Sala Calma` 12 €, `Sala Brisa` 15 €, `Sala Névoa` 18 €; `--room
"Nome:preço"` to change them), the pack (`Pack 10 horas`; `--pack
"Nome:horas:preço:dias"`), and your admin account without a password, and
**prints the "Defina a sua password" link** (valid 60 minutes; with
`EMAIL_MODE=live` it is emailed too). Running it again changes nothing.

Smoke checklist, in the browser and on the host:

- [ ] `https://app.flowspace.pt/` loads with the padlock; `/backend/health` → `{"status":"ok"}`.
- [ ] The set-password link works; sign in; `/admin` shows the organisation, the rooms, the pack.
- [ ] As a new customer (another browser): sign up, pick a room, book an hour — the stub checkout page confirms it; the booking shows on `/dashboard` and in `/admin/bookings`.
- [ ] Upload a photo to a room (`/admin/rooms`); it renders on the public page.
- [ ] The help form (`/ajuda`) accepts a message (stub email: `docker compose … logs backend | grep "STUB EMAIL"`).
- [ ] `aws logs tail /spacerental/prod --since 10m` shows the three streams; `systemctl list-timers spacerental-backup.timer` shows tonight's run; `sudo /srv/spacerental/backup.sh` once by hand → `aws s3 ls s3://<backups_bucket>/dumps/`.
- [ ] The alarm email: confirm the SNS subscription from the mail AWS sent you. `spacerental-prod-backup-missing` is in ALARM until the first nightly backup after this deploy (or the manual run above) — expected (E15).

## Phase 4 — go-live switches

Each `.env` change: edit `.env.production`, `put-parameter` (2.4), then
`gh workflow run deploy.yml --ref main`.

1. **Email (Resend):** verify `flowspace.pt` at Resend (the SPF/DKIM records
   it gives you, in your DNS), create an API key, set `EMAIL_MODE=live` and
   `RESEND_API_KEY=re_…`, deploy. Then Admin → Definições → Email → "Enviar
   email de teste" to your own address; the card lists delivery failures
   (README "Pôr os emails a funcionar (Resend)").
2. **Payments (Stripe):** in the Stripe dashboard, live mode: the secret key;
   a webhook endpoint `https://app.flowspace.pt/backend/api/v1/webhooks/stripe`
   listening to `checkout.session.completed` — its signing secret; payment
   methods: cards and MB WAY **on**, Multibanco **off** (its references
   settle later than a 15-minute booking hold). Set `STRIPE_MODE=live`,
   `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, deploy. Make one real
   1-hour booking and refund it in Stripe.
3. **`APP_ENV=production`** is already in the file: confirm it is still
   there — it is what refuses a development default on the next deploy.
4. **The site's door:** in `flowspace-site/assets/data/business.json` set
   `booking.url` to the value of `booking.app_url`
   (`https://app.flowspace.pt`), run `python3 flowspace-site/scripts/render-static.py`,
   commit both through a PR. Every "Reservar" on flowspace.pt, the JSON-LD
   action and `llms.txt` then point at the app.

## Phase 5 — running it

- **Logs:** `aws logs tail /spacerental/prod --follow` (streams `caddy`,
  `frontend`, `backend`); on the host `docker compose … logs --tail 200 backend`.
- **Backups:** nightly at 03:00 Lisbon (`journalctl -t spacerental-backup`);
  dumps keep 30 days in `s3://<backups_bucket>/dumps/`, media is synced
  additively to `media/`, the data volume is snapshotted daily (7 kept).
- **Restore drill** (do it once before you need it):

  ```bash
  # on the host, as root, in /srv/spacerental
  docker compose -f docker-compose.prod.yml -f docker-compose.prod.awslogs.yml stop frontend backend
  BACKUP_BUCKET=<backups_bucket> AWS_REGION=eu-west-1 ./restore.sh 2026-10-13.dump media/
  #   (prompts for the database name; drops and recreates everything in the dump)
  docker compose -f docker-compose.prod.yml -f docker-compose.prod.awslogs.yml start backend frontend
  ```

- **Alarms** (email): instance system check failed (the instance is
  recovered automatically), disk > 80 % on either volume, RDS free storage
  < 2 GB, RDS CPU > 80 % for 15 minutes, the Budget at 80/100 %, and
  **a day without a successful backup** (`spacerental-prod-backup-missing`,
  E15: `backup.sh` publishes `FlowSpace/BackupSucceeded` after every run;
  a run that fails also emails its last 50 journal lines through
  `spacerental-backup-failed.service`). That alarm is in ALARM from the
  apply until the first nightly run after the first deploy — expected;
  `sudo systemctl start spacerental-backup.service` once by hand clears it
  earlier.
- **Patching:** the host installs security updates on its own
  (`unattended-upgrades`, no automatic reboot). Monthly:
  `sudo apt-get update && sudo apt-get dist-upgrade -y && sudo reboot` in a
  quiet hour — the stack is `restart: unless-stopped` and comes back by
  itself. Application dependencies: Dependabot's PRs, once merged, deploy
  themselves like any other merge.
- **Rollback:** a deploy whose containers do not get healthy within 120 s
  rolls itself back to the previous release (E14): the job goes red with
  "the host rolled back to `<sha>`" in its summary, the site keeps serving,
  the schema stays as the new migration left it (every migration must
  leave the previous release working — CLAUDE.md §6.5). To go back by
  hand: `gh workflow run deploy.yml --ref main -f sha=<the previous
  commit>` — the images for every deployed commit stay in ECR (the last
  10 tags); the host keeps the current and the previous one (E13).
- **Pause everything:** `gh variable set DEPLOY_ENABLED --body false` (no
  deploy runs; the site keeps serving) and `gh variable set INFRA_ENABLED
  --body false` (no plan or apply). Setting them back to `true` re-arms.
- **Gating app deploys too** (optional): add yourself as required reviewer
  to the `production-app` environment (Settings → Environments); every
  deploy then waits for your approval. Without a reviewer — how 2.2
  creates it — app deploys are continuous once enabled, and only
  infrastructure applies are gated (E05 decision, E10 revision). What the
  deploy role can do from that environment is exactly one thing: send the
  `spacerental-deploy` SSM document, i.e. `deploy.sh <sha>` on the host.
- **If the repository ever turns private:** the deploy job runs on
  GitHub's hosted arm64 runner (`ubuntu-24.04-arm`), free for public
  repositories only; switch `runs-on` to `ubuntu-latest` and add
  `docker/setup-qemu-action` before the builds (slower, emulated).
- **A new `.env` value:** `put-parameter` + `gh workflow run deploy.yml --ref main`.
- **Tearing it down:** `INFRA_ENABLED=false`, then from the laptop
  `cd infra/prod && terraform init && terraform destroy` (RDS has deletion
  protection: set `deletion_protection = false`, apply, then destroy; it
  takes a final snapshot), then `cd ../bootstrap && terraform destroy`
  (empty the state bucket first).

## Repository settings, in one place

| Kind | Name | Value |
|---|---|---|
| Variable | `AWS_ACCOUNT_ID` | the 12-digit account id |
| Variable | `AWS_REGION` | `eu-west-1` |
| Variable | `APP_DOMAIN` | `app.flowspace.pt` |
| Variable | `INFRA_ENABLED` | `true` to let `infra.yml` plan and apply |
| Variable | `DEPLOY_ENABLED` | `true` to let `deploy.yml` build and deploy |
| Environment | `production` | required reviewer: fairglen (verify, 2.2); selected branches: `main` |
| Environment | `production-app` | no reviewers (continuous deploys; add one to gate them); selected branches: `main` |

No secret is stored in GitHub: the workflows assume the roles
`infra/bootstrap` created through OIDC, the `.env` lives in SSM (written by
you, 2.4; not a Terraform resource), the database password in Secrets
Manager.
