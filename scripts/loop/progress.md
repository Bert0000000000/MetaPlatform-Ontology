# scripts/loop/progress.md — 手动 checkpoint 替代 TaskCreate
#
# 用法: 每次完成一个 Phase / 模块后更新本文件; 新会话启动时先读本文件了解进度.
# 当 TaskCreate 工具不可用时, 用本文件代替.
# 最后更新: 2026-08-20

## 当前进度（2026-08-20）

### Phase A — Monorepo + CI Scaffold ✅
- [x] `package.json` (pnpm workspaces)
- [x] `pnpm-workspace.yaml`
- [x] `tsconfig.base.json` + `tsconfig.json`
- [x] `vitest.config.ts`
- [x] `eslint.config.js`
- [x] `.gitignore` 扩展
- [x] `.github/workflows/{ci,claude-loop,deploy-prod,release}.yml` 复制
- [x] `.github/pull_request_template.md`
- [x] `scripts/ci/{rls,networkpolicy,evidence,helm}-check.sh`
- [x] `CONTRIBUTING.md`
- [x] `apps/web` 骨架 (TypeScript + vitest)
- [x] `packages/mp-temporal-worker-template` 骨架
- [x] 12 份 PRD staged
- [x] Commit: `e178a43 chore(scaffold): Phase A monorepo + CI workflows + 12 PRDs`

### Phase B — Batch 1 (MP-V6-FOUNDATION-01) ✅ Accepted
- [x] 8 SQL migrations (supabase/migrations/)
- [x] RLS policy templates (supabase/policies/templates.sql)
- [x] 10 K8s namespaces + ResourceQuota + LimitRange (k8s/namespaces/)
- [x] ArgoCD Application (k8s/argoapp/mp-platform-app.yaml)
- [x] Helm umbrella chart (helm/mp-umbrella/Chart.yaml + values*.yaml)
- [x] NetworkPolicy default-deny + 4 allow-matrix rules + egress-public
- [x] DR/Backup scripts (wal-g.sh + pg_basebackup-daily.sh)
- [x] DR PITR runbook (runbooks/dr-pitr.md)
- [x] Prometheus alert rules (dr-backup-alerts.yaml)
- [x] RLS exemptions registry (evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md)
- [x] 4 vitest unit tests (tg_audit, tg_inject_tenant, rls_check, wal_g)
- [x] Evidence (evidence/MP-V6-FOUNDATION-01-ACCEPTANCE.md)
- [x] Commit: `222a2d4 feat(foundation): MP-V6-FOUNDATION-01 implementation (5 PRDs)`

### Phase C — Skeletons (TEMPORAL-01 / OBSERVABILITY-01 / DSH-DOCKER-01) ✅ Skeleton

#### C1. TEMPORAL-01 skeleton ✅
- [x] `helm/mp-umbrella/charts/temporal/` (Chart.yaml + values.yaml + templates/server-deployment.yaml)
- [x] `packages/mp-temporal-worker-template/src/context.ts` (AsyncLocalStorage TenantContext)
- [x] `packages/mp-temporal-worker-template/src/workflows/index.ts` (hello + long-task + signal)
- [x] `packages/mp-temporal-worker-template/src/activities/index.ts` (sayHello / heartbeatStep / dbRead / dbWrite / approvalRequest)
- [x] `packages/mp-temporal-worker-template/src/worker.ts` (NativeConnection + runWithContext)
- [x] `packages/mp-temporal-worker-template/src/index.ts`
- [x] `packages/mp-temporal-worker-template/tests/context.test.ts` (5 cases)

#### C2. OBSERVABILITY-01 skeleton ✅
- [x] `helm/mp-umbrella/charts/observability/` (Chart.yaml + values.yaml with 5 deps)
- [x] `k8s/observability/otel-collector-config.yaml` (3 pipelines: traces/metrics/logs)
- [x] `dashboards/app-health.json` (Grafana dashboard skeleton)
- [x] `prometheus/rules/mp-app-alerts.yaml` (5 alerts + 1 referenced from dr-backup)

#### C3. DSH-DOCKER-01 skeleton ✅
- [x] `docker/dsh/Dockerfile` (multi-stage deps→build→runtime, node:22.19-alpine, tini, UID 10001, EXPOSE 3000/3001/3002)
- [x] `docker/dsh/.dockerignore`
- [x] `.github/workflows/dsh-build.yml` (build + trivy + cosign + size check ≤ 500MB)

### Phase D — Loop Automation ✅
- [x] CronCreate 30-min scheduled task (`mp-v6-loop`)
- [x] `scripts/loop/run-once.sh` (探测 next batch + 输出任务清单)
- [x] `.claude/loop-prompt.md` §0.x + §15 (CronCreate 调度模板)

### Sprint 0 完成状态

- [x] FOUNDATION-01 ✅ Accepted
- [ ] TEMPORAL-01 (skeleton, 待 live-deploy)
- [ ] OBSERVABILITY-01 (skeleton, 待 live-deploy)
- [ ] DSH-DOCKER-01 (skeleton, 待 live-deploy)
- [ ] MIGRATION-01 (Sprint 3 末, 未启动)

---

## 下次会话启动第一步

```bash
cat scripts/loop/progress.md   # 看进度
git log --oneline -10          # 看最近 commits
git status                     # 看未提交改动
bash scripts/loop/run-once.sh  # 看下一个 batch 任务清单
```

---

## 待用户在宿主机完成的事

Phase A+B+C+D 的代码全部落地并通过静态校验. 但真正**部署到 K8s** 需要用户在自己机器上跑:

1. `terraform apply` (3 套 K8s 集群)
2. `kubectl apply -f k8s/namespaces/`
3. `kubectl apply -f k8s/networkpolicies/`
4. `helm install mp helm/mp-umbrella/ -n mp-infra`
5. `supabase db push` (应用 8 个 migration)
6. `docker build -t mp/dsh-web:v6.0.0-<sha> -f docker/dsh/Dockerfile .`

CronCreate 调度任务（`mp-v6-loop`）会每 30 分钟在宿主机 Claude Code 桌面应用里自动跑，
接力 TEMPORAL-01 / OBSERVABILITY-01 / DSH-DOCKER-01 的 live-deploy 验证 + 后续 Batch。