# Release process

ReefTone uses Semantic Versioning in the form `MAJOR.MINOR.PATCH`.

- `MAJOR`: incompatible file, API, workflow, or processing behavior
- `MINOR`: compatible user-facing features or substantial algorithm improvements
- `PATCH`: compatible fixes, polish, documentation, and small UX improvements

The Python package version, API version, frontend version constant, HTML asset
versions, Git tag, and GitHub release must agree.

## Release checklist

1. Start from a clean `main` branch synchronized with `origin/main`.
2. Move completed entries from `Unreleased` in `CHANGELOG.md` into a dated version.
3. Update the version in:
   - `pyproject.toml`
   - `src/reeftone/__init__.py`
   - `src/reeftone/app.py`
   - `src/reeftone/static/app.js`
   - `src/reeftone/static/index.html`
4. Run:

   ```bash
   pytest -q
   ruff check .
   git diff --check
   ```

5. Verify image loading, presets, comparison modes, zoom/pan, copied settings, and
   every export format in the browser.
6. Commit with a focused Conventional Commit message.
7. Merge through a pull request when the change is not an emergency.
8. Create an annotated `vMAJOR.MINOR.PATCH` tag on the release commit.
9. Push the tag and publish GitHub release notes based on the changelog.
10. Confirm `main`, the tag, and the release all identify the same commit.

## Commit conventions

Use short, imperative Conventional Commit subjects:

- `feat:` compatible user-facing functionality
- `fix:` bug correction
- `perf:` performance improvement
- `docs:` documentation only
- `test:` test-only change
- `refactor:` internal restructuring without behavior changes
- `chore:` maintenance and repository tooling

Keep algorithm changes, interface changes, and repository maintenance in separate
commits whenever practical. Never combine source photographs or generated caches
with application commits.

## Release notes

Release notes should explain:

- what users can do now
- important color or file-preservation behavior
- known limitations and safe fallbacks
- how the release was verified
- whether a migration or configuration change is required
