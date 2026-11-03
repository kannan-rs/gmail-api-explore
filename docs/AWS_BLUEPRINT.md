# AWS Deployment Blueprint

This is a target design, not provisioned infrastructure. Local V1 deliberately has no
application login and binds to `127.0.0.1`; do not expose it directly to the internet.

## Target architecture

```text
Route 53 / ACM TLS
        |
      ALB  ---->  ECS Fargate service (Node API + built React UI)
        |                 |
        |                 +--> RDS PostgreSQL (private subnets)
        |                 +--> Secrets Manager (Google client, keys, DB)
        |                 +--> CloudWatch Logs/Metrics/Alarms
        |                 +--> S3 (exports, future attachment staging)
        |
        +--> Cognito or ALB authentication in front of UI/API

EventBridge scheduled task --> reconciliation job (every 6 hours)
GitHub Actions --> test/typecheck/lint/build --> ECR --> ECS deploy + migration task
```

## Components

### Runtime

- ECS Fargate service running the `npm run build` output (`dist/server.js` and
  `dist/web`).
- One task minimum for the experiment; add autoscaling on CPU and request count later.
- ALB with ACM TLS and a health check on `/api/health`.
- Container reads all configuration from environment variables injected by Secrets Manager;
  never bake secrets into the image.

### Database

- RDS PostgreSQL in private subnets.
- Encryption at rest, automated backups, deletion protection, and a maintenance window.
- Security group allows only the ECS task security group.
- Run migrations as a one-off ECS task before deploying the new service revision.
- Use the same Drizzle migrations and a separate database per environment.

### Secrets

Store in AWS Secrets Manager:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `TOKEN_ENCRYPTION_KEY`, `COOKIE_SECRET`
- `DATABASE_URL` or the RDS username/password pieces
- No other provider credentials; V1 is Gmail-only

Rotate the token encryption key with a planned re-encryption migration; changing it makes
existing stored refresh tokens unreadable.

### OAuth and identity

- Register an HTTPS redirect URI in Google Cloud for each environment.
- Complete Google OAuth branding/verification for the restricted `gmail.metadata` scope.
- Workspace phase: confirm admin approval, aliases, and `sendAs` configuration.
- Put Cognito or ALB authentication in front of the UI/API. Local V1 has no app login.

### Observability

- CloudWatch logs with token, cookie, authorization-header, and message-body redaction.
- Metrics/alarms for send failures, Gmail auth errors, verification lag, daily-cap hits,
  database connections, and HTTP 5xx rate.
- Keep an audit retention policy for the ledger and exports.

### Storage and scheduling

- S3 bucket for CSV exports and future attachment staging, with lifecycle rules and
  least-privilege access.
- EventBridge scheduled ECS task calls reconciliation every 6 hours; persist the result in
  logs/metrics.
- Network egress from the task must reach Google OAuth and Gmail API endpoints.

### Guardrails

- WAF/rate limiting at the edge; daily cap enforced in the application against the ledger.
- Least-privilege IAM task role: no broad S3/Secrets access.
- No public database access.
- Separate dev/staging/production accounts or at least separate VPCs and databases.
- Backups and restore drills before relying on the ledger as audit evidence.

## CI/CD

1. Install Node 24 and dependencies.
2. Run `npm test`, `npm run typecheck`, and `npm run lint`.
3. Run `npm run build`.
4. Build and push the container image to ECR with an immutable tag.
5. Run the migration task against the target database.
6. Deploy the new ECS task definition/service revision.
7. Smoke-test `/api/health` and a non-sending read endpoint.

## Migration path from local V1

1. Add application authentication and TLS.
2. Move PostgreSQL to RDS and run the migration task.
3. Move secrets to Secrets Manager.
4. Register the production OAuth redirect URI and complete Google verification.
5. Add reconciliation scheduling and CloudWatch alarms.
6. Only then connect a production or Workspace mailbox.
7. Confirm auditor retention/access requirements before importing real borrower data.

## Open decisions

- AWS account, region, and domain.
- Cognito versus ALB authentication.
- Retention period for message bodies and recipient data.
- Whether attachments stay as base64 JSON or move to S3/multipart immediately.
- Whether Workspace domain-wide delegation is required.
