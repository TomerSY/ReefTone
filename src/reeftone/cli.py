"""Command-line entry point."""

from __future__ import annotations

import argparse
import webbrowser

import uvicorn


def main() -> None:
    parser = argparse.ArgumentParser(description="Launch the ReefTone local studio")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address")
    parser.add_argument("--port", type=int, default=8765, help="Local port")
    parser.add_argument("--no-browser", action="store_true", help="Do not open a browser")
    args = parser.parse_args()
    if not args.no_browser:
        webbrowser.open(f"http://{args.host}:{args.port}")
    uvicorn.run("reeftone.app:app", host=args.host, port=args.port, reload=False)


if __name__ == "__main__":
    main()
