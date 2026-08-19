<<<<<<< HEAD
# OntologyMetaPlatform
=======
# MetaPlatform-Ontology

> **MetaPlatform v6.0** — 以 DeepSeek Harness (dsh) 为核心的企业级 AI 平台（完全重启）
>
> 详见 [`CLAUDE.md`](./CLAUDE.md) 与 [`START.md`](./START.md)。

---

## 项目状态（2026-08-20）

| 项 | 状态 |
|---|---|
| 文档骨架 | ✅ 已就位（CLAUDE.md / START.md / specs / batch / decisions / runbooks / workflows / scripts / loop-prompt） |
| 代码 | ❌ 尚未生成（Sprint 0 第一个 Batch 才产出代码） |
| GitHub 仓库 | ❓ 待用户确认 org 与 repo 名 |
| 本地环境工具 | ⚠️ 见下表 |

## 目录结构

```
MetaPlatform-Ontology/
├── CLAUDE.md                 # 项目上下文（架构、决策、Batches、强约束）
├── START.md                  # 启动指令（7 步执行流程）
├── README.md                 # 本文件
├── docs/active/
│   ├── specs/                # 架构 / 应用架构 / 模块规划（3 份）
│   ├── batch/                # Sprint 0 5 个 Batch + 1 个 MIGRATION
│   ├── decisions/            # ADR-0060：抛弃 v3.0
│   ├── runbooks/             # archive-v3-repository
│   └── workflows/            # 4 个 GitHub Actions yml
├── scripts/loop/             # new-batch.sh / next-batch.sh
├── .claude/loop-prompt.md    # Claude Code loop 提示词
└── evidence/                 # （每个 Batch 完成后写 ACCEPTANCE.md）
```

## Sprint 0 待执行（4 个 P0 Batch）

| Batch | 周 | 关键能力 |
|---|---|---|
| MP-V6-FOUNDATION-01 | 4 | K8s 3 套 + Supabase 8 能力 + RLS + NetworkPolicy |
| MP-V6-TEMPORAL-01 | 3 | Temporal Cluster + Worker |
| MP-V6-OBSERVABILITY-01 | 2 | OTel + Grafana |
| MP-V6-DSH-DOCKER-01 | 2 | dsh 镜像 |

执行方式见 `START.md`，自动化靠 `.claude/loop-prompt.md` + `claude-loop.yml`。
>>>>>>> e1e2092 (feat: initial v6.0 documentation + CI/CD + workflow templates)
