#!/usr/bin/env sh
set -eu

alembic upgrade head
python - <<'PY'
from sqlalchemy.orm import configure_mappers
from app.main import app

configure_mappers()
print(f"migration validation ok: {app.title}")
PY
