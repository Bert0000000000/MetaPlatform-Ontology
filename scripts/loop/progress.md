# scripts/loop/progress.md — 手动 checkpoint 替代 TaskCreate
#
# 用法: 每次完成一个 Phase / 模块后更新本文件; 新会话启动时先读本文件了解进度.
# 当 TaskCreate 工具不可用时, 用本文件代替.

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

### Phase B — Batch 1 (MP-V6-FOUNDATION-01, 4 weeks) — 进行中

#### B1. K8s clusters + namespaces
- [ ] `terraform/{mp-prod,mp-staging,mp-dev}/`
- [ ] `k8s/namespaces/*.yaml` (10 个 ns)
- [ ] `k8s/argoapp/`
- [ ] `helm/mp-umbrella/Chart.yaml`

#### B2. Supabase schema ✅
- [x] `20260820120000_init_extensions.sql`
- [x] `20260820120100_create_tenants.sql`
- [x] `20260820120200_create_profiles.sql`
- [x] `20260820120300_create_audit_log.sql`
- [x] `20260820120400_create_tg_audit_function.sql`
- [x] `20260820120500_rls_baseline_policies.sql`
- [x] `20260820120600_tg_inject_tenant.sql`
- [x] `20260820120700_create_temporal_schema.sql`

#### B3. RLS policy
- [x] `supabase/policies/templates.sql` (4 模板)
- [x] `evidence/MP-V6-FOUNDATION-01-RLS-EXEMPTIONS.md`
- [ ] `tests/ci/rls-check.test.ts` (vitest)

#### B4. NetworkPolicy
- [ ] `k8s/networkpolicies/default-deny.yaml`
- [ ] `k8s/networkpolicies/allow-matrix/*.yaml`
- [ ] `k8s/networkpolicies/egress-public.yaml`

#### B5. DR / Backup
- [ ] `scripts/backup/wal-g.sh`
- [ ] `scripts/backup/pg_basebackup-daily.sh`
- [ ] `helm/mp-umbrella/charts/velero/`
- [ ] `runbooks/dr-pitr.md`
- [ ] `prometheus/rules/*.yaml`

#### B6. Unit tests (vitest)
- [ ] `tests/supabase/tg_audit.test.ts`
- [ ] `tests/policies/rls_templates.test.ts`
- [ ] `tests/backup/wal_g.test.ts`
- [ ] `tests/ci/rls_check.test.ts`

#### B7. Evidence
- [ ] `evidence/MP-V6-FOUNDATION-01-ACCEPTANCE.md`

### Phase C — Skeletons (TEMPORAL-01 / OBSERVABILITY-01 / DSH-DOCKER-01)

#### C1. TEMPORAL-01 skeleton
- [ ] `helm/mp-umbrella/charts/temporal/`
- [ ] `packages/mp-temporal-worker-template/src/{worker,workflows,activities}/*.ts`
- [ ] `tests/temporal/`

#### C2. OBSERVABILITY-01 skeleton
- [ ] `helm/mp-umbrella/charts/observability/`
- [ ] `k8s/observability/otel-collector-config.yaml`
- [ ] `dashboards/*.json`
- [ ] `prometheus/rules/*.yaml`

#### C3. DSH-DOCKER-01 skeleton
- [ ] `docker/dsh/Dockerfile`
- [ ] `docker/dsh/.dockerignore`
- [ ] `.github/workflows/dsh-build.yml`

### Phase D — Loop Automation

- [ ] CronCreate 30-min scheduled task
- [ ] `scripts/loop/run-once.sh`
- [ ] `.claude/loop-prompt.md` §0.x + §15

---

## 下次会话启动第一步

```bash
cat scripts/loop/progress.md   # 看进度
git log --oneline -10          # 看最近 commits
git status                     # 看未提交改动
```