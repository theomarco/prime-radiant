#!/usr/bin/env python3
"""Serve api/seldon.py locally so `next dev` can reach it.

On Vercel the Python function is served by the platform's filesystem phase, but
the Next dev server owns every route locally, so `vercel dev` returns its 404
page for /api/seldon. This runs the same handler on its own port; next.config.ts
rewrites /api/seldon here in development only.

    python3 scripts/dev-seldon.py     # then, separately, npm run dev
"""
import importlib.util
import os
import sys
from http.server import HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PORT = int(os.environ.get("SELDON_DEV_PORT", "3999"))

env_file = ROOT / ".env.local"
if env_file.exists():
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

for required in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "NEURALK_API_KEY"):
    if not os.environ.get(required):
        sys.exit(f"{required} is not set. Copy .env.example to .env.local and fill it in.")

spec = importlib.util.spec_from_file_location("seldon", ROOT / "api" / "seldon.py")
seldon = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seldon)

print(f"seldon dev function on http://127.0.0.1:{PORT}")
HTTPServer(("127.0.0.1", PORT), seldon.handler).serve_forever()
