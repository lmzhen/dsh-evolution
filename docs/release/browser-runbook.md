# npm Trusted Publishing browser automation runbook

Use the installed dsh-browser (bridge extension) after logging into npmjs.com in that browser profile.

## Fixed form values

```text
Owner:          lmzhen
Repository:     dsh-evolution
Workflow:       release.yml
Environment:    npm-publish
Allowed action: npm publish
```

## Package order (29)

1. @lmzhen/dsh-evolution
2. @lmzhen/dsh-evolution-activity
3. @lmzhen/dsh-evolution-agent-preset
4. @lmzhen/dsh-evolution-approval
5. @lmzhen/dsh-evolution-capability
6. @lmzhen/dsh-evolution-commands
7. @lmzhen/dsh-evolution-core
8. @lmzhen/dsh-evolution-curator
9. @lmzhen/dsh-evolution-feedback
10. @lmzhen/dsh-evolution-host
11. @lmzhen/dsh-evolution-io
12. @lmzhen/dsh-evolution-io-node
13. @lmzhen/dsh-evolution-learning-graph
14. @lmzhen/dsh-evolution-plan-validator
15. @lmzhen/dsh-evolution-policy
16. @lmzhen/dsh-evolution-preset
17. @lmzhen/dsh-evolution-replay
18. @lmzhen/dsh-evolution-review
19. @lmzhen/dsh-evolution-skill-catalog
20. @lmzhen/dsh-evolution-state
21. @lmzhen/dsh-evolution-state-domain
22. @lmzhen/dsh-evolution-state-json
23. @lmzhen/dsh-evolution-state-storage
24. @lmzhen/dsh-evolution-threat
25. @lmzhen/dsh-memory
26. @lmzhen/dsh-memory-files
27. @lmzhen/dsh-skill-usage
28. @lmzhen/dsh-tool-memory
29. @lmzhen/dsh-tool-skill-manage

## Per-package steps

1. Open the package settings/access page and locate the Trusted Publisher section.
2. Select GitHub Actions.
3. Fill the fixed form values above.
4. Screenshot the completed form before saving.
5. Save. If npm asks for OTP or a second confirmation, pause and ask the human.
6. Record the result in oidc-checklist.md.

## DSH prompt to drive the loop

```text
使用 browser 工具在已登录的 npmjs.com 会话中，按 docs/release/browser-runbook.md 的清单依次为每个 @lmzhen/dsh-* 包配置 Trusted Publishing。
每处理完一个包：browser_screenshot 保存证据，更新 docs/release/oidc-checklist.md 勾选状态；遇到 OTP 或二次确认立即停下等我。
不要在未截图前点击保存；不要修改包的其他 access、token 或 2FA 设置。
```

