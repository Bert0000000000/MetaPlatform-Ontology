#!/usr/bin/env bash
# scripts/ci/helm-validate.sh
# CI gate: validate Helm charts with kubeconform (skips if kubeconform not installed)
# Per PRD: docs/active/prd/foundation-rls-policy.md §7 (8-gate CI list)
#
# Strict kubeconform: requires Kubernetes 1.31 schemas, ignores missing schemas,
# and treats unknown fields as errors.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

if [ ! -d "$REPO_ROOT/helm" ] && [ ! -d "$REPO_ROOT/k8s" ]; then
  echo "::warning::helm-validate: no helm/ or k8s/ directory; skipping"
  exit 0
fi

if ! command -v kubeconform >/dev/null 2>&1; then
  echo "::warning::helm-validate: kubeconform not installed; skipping (install: https://github.com/yannh/kubeconform)"
  echo "::warning::On the host machine, run: docker run --rm -v \"\$PWD:/repo\" ghcr.io/yannh/kubeconform:latest -strict -summary -ignore-missing-schemas /repo/helm/"
  exit 0
fi

echo "⎈ Helm Validate — kubeconform $(kubeconform -v)"

ERRORS=0

for dir in helm k8s; do
  if [ -d "$REPO_ROOT/$dir" ]; then
    echo "  scanning $dir/"
    if ! kubeconform \
        -strict \
        -summary \
        -ignore-missing-schemas \
        -kubernetes-version 1.31.0 \
        -schema-location default \
        -schema-location 'https://raw.githubusercontent.com/datreeio/CRDs-catalog/main/{{.Group}}/{{.ResourceKind}}_{{.ResourceAPIVersion}}.json' \
        "$REPO_ROOT/$dir/" 2>&1; then
      ERRORS=$((ERRORS + 1))
    fi
  fi
done

if [ "$ERRORS" -gt 0 ]; then
  echo "::error::helm-validate: $ERRORS chart(s) failed validation"
  exit 1
fi

echo "✅ helm-validate passed"
exit 0