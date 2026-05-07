from __future__ import annotations

import argparse
import sys
import time
from urllib.request import Request, urlopen


def fetch_json(url: str, timeout: float) -> int:
    request = Request(url, headers={"Accept": "application/json"})
    with urlopen(request, timeout=timeout) as response:
        response.read()
        return int(response.status)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Aventaro deployment health gates.")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--timeout", type=float, default=5.0)
    parser.add_argument("--retries", type=int, default=24)
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")
    targets = ["/health/live", "/health/ready"]
    last_error: Exception | str = "health endpoints did not return 200"
    for attempt in range(1, args.retries + 1):
        try:
            statuses = [fetch_json(f"{base_url}{target}", args.timeout) for target in targets]
            if all(status == 200 for status in statuses):
                print("deployment validation ok")
                return 0
            last_error = f"unexpected statuses: {statuses}"
        except Exception as exc:
            last_error = exc
        time.sleep(5)
    print(f"deployment validation failed: {last_error}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
