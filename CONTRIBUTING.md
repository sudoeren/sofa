# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

Node 22.5 or newer and pnpm:

```sh
pnpm install
pnpm dev
```

The server runs on port 8787 and the web app on 5173. Read
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before larger changes; it describes the data
model and the contracts between packages.

## Before you open a pull request

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

- Keep changes focused; one topic per pull request.
- Add or update tests next to the code you change.
- Commit messages follow conventional commits, for example
  `feat(widgets): add a timer widget` or `fix(server): ...`.
- No emoji in code, UI text, docs or commit messages.

## New built-in tools

A built-in tool is a definition in `packages/widgets/src/defs/<type>.ts` (config schema,
guide for the model, starter, keywords) and a component in
`apps/web/src/widgets/<Type>.tsx`, registered in both `index.ts` files. Store one state key
per independently edited thing, and document every key in the guide.

## Pull requests and releases

Label pull requests so they land in the right section of the release notes:
`feature`, `fix`, `breaking`, `security`, `documentation`, `dependencies`, or
`skip-changelog`.

Releases are cut from `master` by pushing a version tag:

```sh
git tag -a v0.2.0 -m "v0.2.0"
git push origin v0.2.0
```

The release workflow runs the checks, publishes a multi-arch image to
`ghcr.io/sudoeren/sofra` (`0.2.0`, `0.2` and `latest`) and creates the GitHub release with
generated notes. Tags with a suffix such as `v0.2.0-rc.1` become pre-releases and do not
move `latest`.

Every push to `master` that passes CI also deploys the public demo.
