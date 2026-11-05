# Skills and Team Onboarding

## Purpose

This project combines email send engineering, OAuth security, audit evidence, and operational
delivery. The goal is not just to send mail, but to produce a defensible record that Gmail
accepted the message and still has it in the Sent folder.

## Technical skills

### Foundation

- TypeScript strict mode, ES modules, Node.js 24.
- Fastify routing, hooks, error handling, and `inject` tests.
- React function components, hooks, forms, and accessible UI.
- PostgreSQL tables, indexes, constraints, and SQL aggregates.
- Drizzle ORM schema, migrations, and typed repositories.
- Vitest unit/integration tests with a real test database.
- Biome formatting and linting.

### Working

- OAuth 2.0 authorization-code flow with `access_type=offline`.
- Google Identity scopes, test users, redirect URIs, and refresh-token lifetimes.
- Gmail API `users.messages.send`, `users.messages.get(format=metadata)`, and label-based
  `users.messages.list` (the `gmail.metadata` scope does not support `q` search).
- MIME/RFC 5322 message construction and base64url encoding.
- AES-256-GCM token encryption and signed cookies.
- Idempotency keys, request hashing, unique `Message-ID`, and timeout recovery.
- Safe error mapping: no tokens, bodies, or recipient data in logs or API errors.
- React Testing Library and mocked fetch for UI flows.

### Advanced

- Gmail sending limits and Workspace alias/`sendAs` constraints.
- Restricted-scope verification and Workspace admin approval.
- Reconciliation design for lost provider responses and status drift.
- Audit evidence standards, retention, CSV export integrity, and chain of custody.
- AWS ECS Fargate, RDS, ALB/TLS, Secrets Manager, CloudWatch, S3, and EventBridge.
- Incident response for token compromise, mis-sends, and retention failures.

## Domain skills

- Explain why a Gmail Sent copy proves Gmail acceptance, not recipient delivery.
- Know that Gmail always creates a Sent copy and cannot send without one via the API.
- Know that Gmail cannot send as an arbitrary `From` address.
- Understand consumer versus Workspace limits and testing-mode token expiry.
- Treat recipient addresses, subjects, and bodies as PII.
- Define a retention and export policy with the auditor before production.

## Team roles

### Engineer

Owns the application, tests, migrations, provider adapter, UI, and deployment. Must be able to
debug OAuth failures without exposing secrets and must keep the provider boundary clean.

### Google Workspace administrator

Owns the Google Cloud project, OAuth consent screen, scopes, test users, production
verification, mailbox aliases, `sendAs`, and Workspace access policy.

### Auditor / operations reviewer

Owns the evidence standard, retention period, export review, reconciliation sign-off, and
access control expectations.

## Onboarding path

1. Read `docs/PLAN.md` and this document.
2. Run the unit and integration tests with the test database.
3. Read `src/domain/idempotency.ts`, `src/services/send-service.ts`, and
   `src/providers/gmail/gmail-provider.ts`.
4. Complete the OAuth setup guide and connect a personal test mailbox.
5. Send to your own address, verify in the UI, and inspect the Gmail Sent copy.
6. Run reconciliation and export a CSV.
7. Review the AWS blueprint and the open production decisions.

## Guardrails

- Never commit `.env`, refresh tokens, client secrets, or encryption keys.
- Never log request bodies, tokens, cookies, or full provider error payloads.
- Never write `SENT` unless Gmail returned a message ID and the `SENT` label.
- Never claim delivery from a Sent copy.
- Keep the daily cap below the account's sending limit during experiments.
- Reconnect immediately after `invalid_grant`; do not retry with a revoked token.
- Confirm retention and access requirements before storing real borrower data.
