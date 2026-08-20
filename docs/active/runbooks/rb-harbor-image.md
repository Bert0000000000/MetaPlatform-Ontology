# Runbook：Harbor 镜像推送 / 拉取失败

> **适用**：dsh 镜像构建后推不到 Harbor / K8s 拉镜像失败 / 漏洞扫描误报
> **严重度**：P1（CI/CD 中断）
> **负责人**：SRE + AI 团队
> **最后更新**：2026-08-20

---

## 1. 适用场景

| 场景 | 触发 | 行动 |
|---|---|---|
| **镜像 push 失败** | GitHub Actions 报错 | §3.1 |
| **K8s 拉镜像失败** | `ImagePullBackOff` | §3.2 |
| **trivy 扫描误报** | High/Critical 漏洞阻断 push | §3.3 |
| **镜像启动崩溃** | `CrashLoopBackOff` | §3.4 |
| **Harbor 不可达** | Harbor 502/timeout | §3.5 |

---

## 2. 前置检查

```bash
# 1. Harbor 健康
curl -I https://harbor.mp-platform.local/api/v2.0/health

# 2. 项目存在
curl -u "$HARBOR_USERNAME:$HARBOR_PASSWORD" \
  https://harbor.mp-platform.local/api/v2.0/projects | jq '.[] | .name'

# 3. 镜像版本列表
curl -u "$HARBOR_USERNAME:$HARBOR_PASSWORD" \
  "https://harbor.mp-platform.local/api/v2.0/projects/mp/repositories/dsh-web/artifacts?page_size=10" \
  | jq '.[] | .tags[].name'

# 4. K8s 拉镜像测试
kubectl run test --rm -it --restart=Never \
  --image=harbor.mp-platform.local/mp/dsh-web:latest \
  --overrides='{"spec":{"imagePullSecrets":[{"name":"harbor-secret"}]}}' \
  --command -- echo OK
```

---

## 3. 故障 SOP

### 3.1 镜像 push 失败

```bash
# 1. 查 GitHub Actions 日志
gh run list --workflow=dsh-build.yml --limit 5
gh run view <run-id> --log-failed

# 2. 常见原因：
# a) Harbor 凭证过期 → 重新设置 GitHub Secrets
gh secret set HARBOR_USERNAME
gh secret set HARBOR_PASSWORD

# b) Harbor 磁盘满
curl -u admin:admin \
  https://harbor.mp-platform.local/api/v2.0/systeminfo | jq '.storage'
# 解决：清理旧镜像 / 扩磁盘

# c) 网络问题（沙箱无法访问 Harbor）
# 解决：本地 build + push

# 3. 手动重试 push
docker login harbor.mp-platform.local -u "$HARBOR_USERNAME" -p "$HARBOR_PASSWORD"
docker push harbor.mp-platform.local/mp/dsh-web:v6.0.0-<sha>
```

### 3.2 K8s 拉镜像失败

```bash
# 1. 看 pod 状态
kubectl describe pod <pod-name> -n mp-runtime | grep -A 5 'Events:'

# 常见错误：
# - ImagePullBackOff: 凭证 / 网络 / 镜像不存在
# - ErrImagePull: 同上
# - ErrImageNeverPull: imagePullPolicy: Never 但本地无

# 2. 凭证检查
kubectl get secret -n mp-runtime harbor-secret
kubectl get secret -n mp-runtime harbor-secret -o jsonpath='{.data.\.dockerconfigjson}' | base64 -d

# 3. 重新创建凭证
kubectl create secret docker-registry harbor-secret \
  -n mp-runtime \
  --docker-server=harbor.mp-platform.local \
  --docker-username="$HARBOR_USERNAME" \
  --docker-password="$HARBOR_PASSWORD" \
  --docker-email=ops@mp-platform.local \
  --dry-run=client -o yaml | kubectl apply -f -

# 4. 验证
kubectl run test --rm -it --restart=Never \
  --image=harbor.mp-platform.local/mp/dsh-web:latest \
  -n mp-runtime \
  --command -- echo OK
```

### 3.3 trivy 扫描误报

```bash
# 1. 看具体漏洞
trivy image harbor.mp-platform.local/mp/dsh-web:v6.0.0-<sha>

# 2. 分类处理：
# a) 真漏洞 → 升级 base image（alpine）
docker build --build-arg ALPINE_VERSION=3.21 -t ... .
# 重 build

# b) 误报（已知问题 / 不影响）
# 加到 .trivyignore
cat >> .trivyignore <<EOF
CVE-2024-12345
EOF
# 重新触发 CI

# 3. 查看 ignore 列表是否生效
trivy image --ignorefile .trivyignore harbor.mp-platform.local/mp/dsh-web:latest
```

### 3.4 镜像启动崩溃

```bash
# 1. 看启动日志
kubectl logs <pod> -n mp-runtime --previous

# 2. 常见原因：
# a) 缺少环境变量（SUPABASE_URL / DSH_PG_URL / OTEL_*）
kubectl describe pod <pod> -n mp-runtime | grep -A 10 'Environment'

# b) tini 没装（PID 1 信号处理问题）
docker run --rm harbor.mp-platform.local/mp/dsh-web:latest ls -la /sbin/tini
# 应该看到 /sbin/tini

# c) 非 root 用户权限问题（写文件失败）
docker run --rm -u 10001 harbor.mp-platform.local/mp/dsh-web:latest touch /tmp/test
# 验证能写

# d) pg 不可达
docker run --rm harbor.mp-platform.local/mp/dsh-web:latest \
  nc -zv <pg-host> 5432

# 3. 修复后重新 build + push
```

### 3.5 Harbor 不可达

```bash
# 1. 看 Harbor pod
kubectl get pods -n harbor -l goharbor.io/name

# 2. 查日志
kubectl logs -n harbor -l goharbor.io/name=core

# 3. 修复 / 重启 Harbor core
kubectl rollout restart deployment/harbor-core -n harbor

# 4. 备选：推 Docker Hub 或 GHCR
# 见 foundation-dr-backup PRD §10 备选方案
```

---

## 4. 回滚步骤

如果新镜像有问题：

```bash
# 1. Helm rollback 到上一个版本
helm history dsh-web -n mp-runtime
helm rollback dsh-web <PREVIOUS_REVISION> -n mp-runtime

# 2. 或指定 image.tag 改为上一个
kubectl set image deployment/dsh-web \
  dsh-web=harbor.mp-platform.local/mp/dsh-web:v6.0.0-<previous-sha> \
  -n mp-runtime
```

---

## 5. 升级检查表

- [ ] base image 月度 rebuild（alpine 安全更新）
- [ ] trivy 数据库更新（CI 自动）
- [ ] Harbor 备份策略已就位（与 [foundation-dr-backup](../prd/foundation-dr-backup.md) 一致）
- [ ] GitHub Secrets 90 天轮换
- [ ] Image pull policy 正确（生产用 IfNotPresent + SHA tag）

---

## 6. 联系人

| 严重度 | 联系人 | 通知 |
|---|---|---|
| P1（CI/CD 中断 > 1h）| AI 团队 Lead + SRE | Slack #ops-prod |
| P2（单镜像失败）| AI 团队 | Slack #ops-prod |

---

*Runbook v1.0 — 配套 [PRD: dsh-image-spec](../prd/dsh-image-spec.md)*