release: alembic upgrade head
web: RUN_EMBEDDED_WORKERS=false uvicorn app.main:app --host 0.0.0.0 --port ${PORT}
worker: python -m app.worker
