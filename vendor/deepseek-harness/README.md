# vendor/deepseek-harness/README.md
# PRD: docs/active/prd/dsh-60-packages.md §4.1
# Batch: MP-V6-DSH-01
# 实际 dsh 源码不在本仓库 (vendor 模式按需 clone)

## Vendor 流程

```bash
# 在 CI / 用户宿主机执行:
git clone https://github.com/deepseek-ai/deepseek-harness.git vendor/deepseek-harness
cd vendor/deepseek-harness
git checkout <SHA>  # pin 版本, 详见 dsh-image-spec PRD §6
pnpm install --frozen-lockfile --prod --ignore-scripts
```

## Workspace 集成

`pnpm-workspace.yaml` 已声明 `vendor/deepseek-harness/apps/*` 和 `vendor/deepseek-harness/packages/*`。
dsh 的 60 个 Cordis 包通过 pnpm workspaces 暴露给本仓库的其他包使用。

## Pin 版本策略

- 主版本: `v6.0.x` (与 MetaPlatform v6.0 对齐)
- commit SHA: 由 `dsh-image-spec.md` §6 镜像标签决定 (`mp/dsh-web:v6.0.0-<sha>`)
- 升级: 每月评估, 大版本升级必须新开 ADR

## CI 验证

vendor 目录通过 .gitignore 排除 (避免污染 git), 但 `pnpm install` 验证 60 个包 build 通过:

```bash
pnpm install --frozen-lockfile
pnpm -r --filter "@dsh/*" run build  # 如果 dsh 包有 build 脚本
```

## 安全

dsh 源码来自 GitHub; 用 `git checkout <SHA>` 锁定 commit, 不跟随 main。
SHA 由 AI 团队在每次升级时更新, ADR 记录决策。

---

*本目录不直接 commit 源码. CI / 宿主机按需 clone.*