# Contributing to Alexandria

Thanks for considering a contribution!

## Development Setup

```bash
bun install
bun test
bun run check
```

## Pull Requests

- Keep changes focused and add tests where it makes sense.
- Update docs when behavior changes.
- Run `bun test` before opening the PR.

## Coding Standards

- Prefer clear, direct naming and keep changes minimal.
- Avoid introducing `any` in TypeScript.

## Releases

Releases are handled by GitHub Actions on tag pushes (for example, `v0.1.0`).
Make sure `package.json` version matches the tag.
