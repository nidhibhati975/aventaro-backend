# Aventaro Deployment

This repository deploys the backend API, managed background worker, existing admin dashboard, PostgreSQL/PostGIS, Redis, and migrations. The consumer web app is intentionally out of scope for this repo.

## Services

- `api`: FastAPI process running `python -m app.main` with `RUN_EMBEDDED_WORKERS=false` in staging/production.
- `worker`: managed background workers running `python -m app.worker`.
- `migrate`: one-shot Alembic migration gate.
- `postgres`: PostgreSQL with PostGIS enabled.
- `redis`: cache, rate limit, realtime stream, and job coordination.
- `admin`: existing admin dashboard served as static assets.

## Environments

Use separate `.env` files and infrastructure resources for staging and production. Production must use real PostgreSQL, Redis, Stripe, Razorpay, Duffel, S3, CloudFront, Cloudinary, Sentry, and OTLP values before launch. Placeholder credentials are tolerated by local validation only.

Required deployment switches:

- `APP_ENV=staging` or `APP_ENV=production`
- `RUN_EMBEDDED_WORKERS=false` for API containers
- `ALLOW_PLACEHOLDER_CONFIG=false` for real production cutover
- `DATABASE_URL` pointing at PostGIS-enabled PostgreSQL
- `REDIS_URL` pointing at the environment Redis instance

## Deployment Order

1. Build and push immutable API and admin images.
2. Run `alembic upgrade head` with the target environment variables.
3. Start or roll the API containers.
4. Start or roll the worker containers.
5. Start or roll the admin dashboard.
6. Gate release on `/health/live` and `/health/ready`.

## Rollback

Keep the previous API and admin image tags available. If migration or health validation fails, redeploy the previous image tag and keep workers stopped until `/health/ready` is stable. Migrations must remain backward-compatible for at least one deployed version so rollback does not require destructive schema changes.

## Validation

Local compose validation:

```bash
docker compose up --build migrate api worker admin
python scripts/validate_deployment.py --base-url http://localhost:8000
```

Remote compose deployments should set `API_IMAGE`, `ADMIN_IMAGE`, and `IMAGE_TAG` so the same compose file can pull immutable GHCR images instead of building locally.

Backend validation:

```bash
python -m compileall app
python -m pytest tests
alembic upgrade head
```

Mobile validation:

```bash
cd frontend
npx tsc --noEmit
```
