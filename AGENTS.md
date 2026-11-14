# Working on Sofa

Read `docs/ARCHITECTURE.md` first; it holds the data model, the REST contract location and
the tool SDK.

- Package manager: pnpm workspaces. Run commands per package:
  `nice -n 10 pnpm --filter @sofa/server typecheck` (same for `test`).
- The machine is a laptop in use. Keep load low: no root-wide runs while others are
  working, vitest with `--maxWorkers=2`, stop any dev server you start.
- No emoji in code, UI, docs or commit messages.
- Commits: conventional commits (`feat(server): ...`) with a short bullet body, small and
  focused, directly on `master`. Do not push.
- Never use another product's name, logo or look in the UI or docs.
