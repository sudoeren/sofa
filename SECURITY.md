# Security

## Reporting

Please report vulnerabilities by email to hey@erencakar.com rather than in a public issue.
Include steps to reproduce and the version or commit. You will get a reply within a few
days.

## In scope

- Escaping the tool sandbox: a generated tool reading or changing anything beyond its own
  state, or reaching the network.
- Reading or changing a password-protected space without its password or token.
- Server-side request forgery through link previews, path traversal through uploads, or
  anything that runs code on the server.
- AI keys leaking into logs, chat messages or other members' browsers.

## By design

- Anyone with a space's link can read and change everything in it, unless the space has a
  password.
- Members can ask the AI to change or delete any tool in their space.
- A generated tool can navigate its own frame and so send its own data out once before it
  is reset. See [docs/tool-sandbox.md](docs/tool-sandbox.md).
