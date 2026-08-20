## Summary

<!-- 一句话说明这个 PR 做什么 -->

## Batch

- **Batch ID**：`MP-V6-`（必填，从 `docs/active/batch/` 选择）
- **PRD 链接**：`docs/active/prd/-.md`（必填，每个 Batch 启动前必须先有 PRD；CLAUDE.md §8 强约束）
- **spec 链接**（如适用）：`docs/active/specs/2026-08-19-mp-v6-.md`

## Type

- [ ] feat（新功能）
- [ ] fix（bug 修复）
- [ ] chore（工具/构建/依赖）
- [ ] docs（文档）
- [ ] refactor（重构）
- [ ] test（测试）
- [ ] ci（CI 改动）
- [ ] perf（性能优化）

## Acceptance Criteria

复制 Batch 文档的 AC 列表，每项勾选：

- [ ] AC 1
- [ ] AC 2
- [ ] AC 3

## Evidence

- **Evidence 文件**：`evidence/MP-V6---ACCEPTANCE.md`
- [ ] 已创建 / 更新
- [ ] 关键章节齐全（验收标准 / 测试结果 / 部署验证）

## CI Gates (8 项必过)

- [ ] Lint（`pnpm run lint`）
- [ ] Typecheck（`pnpm run typecheck`）
- [ ] Test（`pnpm run test`，coverage ≥ 80%）
- [ ] Build（`pnpm run build`）
- [ ] Evidence Document Check（`scripts/ci/evidence-check.sh`）
- [ ] Secret Scan（gitleaks）
- [ ] Helm + NetworkPolicy Validate（kubeconform + networkpolicy-check.sh）
- [ ] RLS Policy Check（`scripts/ci/rls-check.sh`）

## Constraints Checklist

- [ ] 任务清单**完整执行**（不简化、不跳过）
- [ ] 无 Python 业务代码（v6.0 强制 TypeScript）
- [ ] Secret 不进 git（走 ExternalSecret / Vault）
- [ ] Conventional Commits 格式
- [ ] 不直 push main（走 PR + squash merge）

## Test plan

<!-- 描述你如何验证这次改动 -->

- [ ] 单元测试通过
- [ ] 集成测试通过（mock 外部依赖）
- [ ] 静态校验（kubeconform / sqlfluff / lint）通过
- [ ] 本地 `pnpm run validate:all` 全过

## Linked issues / PRs

Closes #
Refs:
Related:

---

🤖 Generated with [Claude Code](https://claude.ai/code)