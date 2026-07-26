#!/bin/zsh
set -e
cd "$(dirname "$0")"

if [[ ! -x ".venv/bin/python" ]]; then
  python3 -m venv .venv
fi

if ! .venv/bin/python -c "import reeftone" 2>/dev/null; then
  .venv/bin/python -m pip install -e ".[dev]"
fi

exec .venv/bin/reeftone

