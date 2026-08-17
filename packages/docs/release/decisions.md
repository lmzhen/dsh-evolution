# Release decisions

Final Phase 0 decisions for the community release.

- npm account: `lmzhen`
- npm scope: `@lmzhen`
- registry: `https://registry.npmjs.org`
- first version: `0.1.0-rc.1`
- npm dist-tag: `next`
- package set: all 29 packages
- legacy `dsh-evolution`: publish and mark deprecated
- publishing auth: GitHub Actions + npm trusted publishing (OIDC); the first
  release candidate may use interactive `npm publish` as a canary
- long-lived 2FA-bypass GAT: forbidden
- branding: community build; not an official DeepSeek release
- upstream version family for dependency pinning: `0.1.0-rc.6`
- upstream SHA pin: to be recorded before the Phase 1 CI implementation
- install smoke against the public npm registry: allowed to fail until
  upstream `@deepseek-ai/dsh-*` packages publish a complete dependency graph
