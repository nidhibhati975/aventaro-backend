# Aventaro Backend Deployment Guide

Production deployment target: `backend-node` only. Do not deploy the legacy Python backend under `backend/`.

## 1) Choose Hosting Target

Use one of:
- VPS (Ubuntu on DigitalOcean/AWS EC2/Linode)
- Render Web Service
- Railway Service

## 2) Prepare Environment Variables

Create server-side env file from `backend-node/.env.production` and replace all `REPLACE_ME` values:
- `DB_URL`
- `JWT_SECRET`
- `JWT_REFRESH_SECRET`
- `RAZORPAY_KEY_ID`
- `RAZORPAY_KEY_SECRET`
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `STRIPE_CLIENT_SECRET`
- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `UPI_MERCHANT_ID`
- `PAYMENT_WEBHOOK_SECRET`
- `CLOUD_STORAGE_BASE_URL`

Set:
- `NODE_ENV=production`
- `PORT=8000`
- `API_BASE_URL=https://api.aventaro.com`
- `CORS_ORIGINS=https://aventaro.com,https://app.aventaro.com`
- `TRUST_PROXY=true`

## 3) Build + Run (VPS)

From `backend-node`:

```bash
npm ci --omit=dev
npm run start
```

For process management:

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

## 4) Reverse Proxy (Nginx)

Forward `api.aventaro.com` -> `127.0.0.1:8000` and preserve proxy headers:
- `Host`
- `X-Forwarded-For`
- `X-Forwarded-Proto=https`

## 5) DNS Setup

In DNS provider:
- Add `A` record: `api.aventaro.com` -> server public IP
- Wait for propagation and verify:

```bash
nslookup api.aventaro.com
```

## 6) HTTPS (Let's Encrypt)

On Nginx host:

```bash
sudo certbot --nginx -d api.aventaro.com
sudo certbot renew --dry-run
```

## 7) Health Validation

Verify production endpoint:

```bash
curl -i https://api.aventaro.com/health
```

Expected: HTTP `200` and JSON with `status: "ok"`.

## 8) Webhook Hardening Checklist

- Restrict webhook URLs to HTTPS only.
- Configure provider webhook secrets and signature verification.
- Keep webhook endpoints outside auth CSRF checks only where required.
- Keep `/api/dev` disabled by running only with `NODE_ENV=production`.

## 9) Post-Deploy Smoke Tests

- Auth: signup/signin/refresh/logout
- Booking + payment create/verify
- Chat REST + websocket connect at `/ws/chat`
- Affiliate referral apply + payout request
- `GET /health`
