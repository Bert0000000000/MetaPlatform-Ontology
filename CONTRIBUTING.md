# Contributing to MetaPlatform-Ontology v6.0

> 必读：开始任何工作前，请先读 [`CLAUDE.md`](./CLAUDE.md) §8（强约束）和 §7（文件分类规约）。

## 1. 工作流（Trunk-Based + squash merge）

```
main (受保护) ← squash merge ← feat/mp-v6-<batch>-<module>
```

- **唯一长期分支**：`main`
- **功能分支命名**：`feat/mp-v6-<batch-id>-<module>`（如 `feat/mp-v6-foundation-01-supabase-schema`）
- **合并方式**：squash merge（保留线性历史）
- **不直 push main**（CI 必失败 + 保护规则拦截）
- **不 merge 自己的 PR**（除非配置 auto-merge）

## 2. Conventional Commits

```
<type>(<scope>): <subject>

<body>

<footer>
```

**type**（必填）：`feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `ci` / `perf`

**scope**（必填，描述模块）：`foundation` / `temporal` / `observability` / `dsh` / `etl` / `rls` / `networkpolicy` / `backup` / `scaffold` / `loop`

**subject**（必填，祈使句，全小写，≤72 字符）：如 `feat(foundation): add supabase tenant + profile schema`

**body**（可选，72 字符换行，解释 **why** 而不是 what）

**footer**（可选）：
- `Refs: MetaPlatform-FOUNDATION-01`
- `Closes: #123`
- `BREAKING CHANGE: ...`

**PR 标题**必须包含 Batch ID：`feat(foundation): MetaPlatform-FOUNDATION-01 supabase schema`。

## 3. PR checklist（PR 模板会自动渲染）

- [ ] PR 标题含 Batch ID（如 `MetaPlatform-FOUNDATION-01`）
- [ ] PR body 含 PRD 链接（`docs/active/prd/<batch>-<module>.md`）
- [ ] `evidence/<batch>-ACCEPTANCE.md` 已更新（或首次创建）
- [ ] 所有 AC 项已勾选（`[x]`）
- [ ] 8 项 CI gate 全过（lint / typecheck / test / build / evidence-check / secret-scan / helm-validate / rls-check）
- [ ] Conventional Commits 格式
- [ ] Secret 不进 git（ExternalSecret / Vault）
- [ ] 无 Python 业务代码（v6.0 强制 TypeScript）

## 4. 8 项 CI Gate

每个 PR 必须全过：

| # | Gate | 工具 |
|---|---|---|
| 1 | **Lint** | ESLint (`pnpm run lint`) |
| 2 | **Typecheck** | TypeScript (`pnpm run typecheck`) |
| 3 | **Test** | Vitest + coverage ≥ 80% |
| 4 | **Build** | pnpm workspaces build |
| 5 | **Evidence Document Check** | `scripts/ci/evidence-check.sh` |
| 6 | **Secret Scan** | gitleaks |
| 7 | **Helm + NetworkPolicy Validate** | kubeconform + `scripts/ci/networkpolicy-check.sh` |
| 8 | **RLS Policy Check** | `scripts/ci/rls-check.sh` |

本地全部跑：
```bash
pnpm install
pnpm run validate:all
```

## 5. 目录规约（CLAUDE.md §7）

| 类型 | 路径 |
|---|---|
| 技术 spec | `docs/active/specs/2026-08-19-mp-v6-*.md` |
| 模块 PRD | `docs/active/prd/<batch>-<module>.md` |
| Batch 任务文档 | `docs/active/batch/MetaPlatform-*.md` |
| ADR | `docs/active/decisions/ADR-NNNN-*.md` |
| CI/CD workflow | `.github/workflows/*.yml` |
| Runbook | `runbooks/*.md` |
| Loop 脚本 | `scripts/loop/*.sh` |
| 验收证据 | `evidence/<batch>-ACCEPTANCE.md` |

## 6. 接力（新会话 / 新 Codex）

按顺序读：

1. 本文件（CONTRIBUTING.md）
2. [`CLAUDE.md`](./CLAUDE.md)
3. 当前活跃 Batch 文档：`docs/active/batch/<batch>.md`
4. 对应 PRD：`docs/active/prd/<batch>-<module>.md`
5. `.claude/loop-prompt.md`（loop 模式自动接力脚本）

---

*遵循 spec，不凭直觉；不简化任务清单；不跳过 AC。*