// src/pages/MarketplaceUpgrade.tsx — M05 mp-skill-marketplace 升级中 / 加载中 / 空状态 UI
// 设计要点:
//   - 同一组件承载 3 种状态: upgrading (升级中) / loading (加载中) / empty (空状态)
//   - 主图标 (IconHandle) 双层动画: 外圈旋转 + 内圈脉动
//   - 5 阶段时间线: 备份数据 → 迁移 schema → 验证数据 → 更新 Edge Functions → 完成
//   - 整体进度条 + ETA 倒计时
//   - 维护通知 Banner + 推荐操作按钮
import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Progress,
  Space,
  Tag,
  Timeline,
  Typography,
} from '@douyinfe/semi-ui';
import {
  IconAppCenter,
  IconBranch,
  IconCheckCircleStroked,
  IconClose,
  IconFile,
  IconHandle,
  IconHistory,
  IconPulse,
  IconServer,
  IconShield,
  IconSpin,
} from '@douyinfe/semi-icons';
import Stat from '../components/Stat';
import PageHeader from '../components/PageHeader';

const { Title, Text, Paragraph } = Typography;

export type UpgradeMode = 'upgrading' | 'loading' | 'empty';

export interface MarketplaceUpgradeProps {
  mode: UpgradeMode;
  /** 升级开始时间 (ISO), 默认 30 分钟前 */
  startedAt?: string;
  /** 预计总耗时 (秒), 默认 1800 */
  estimatedSeconds?: number;
  /** 已完成百分比 (0-100), 缺省时根据时间自动推算 */
  progress?: number;
  /** 处于第几个阶段 (1-based), 缺省时根据 progress 推算 */
  currentStage?: number;
  /** 阶段错误信息, 若提供则该阶段显示 error */
  stageError?: { stage: number; message: string };
  /** 升级完成后点击 */
  onRetry?: () => void;
  /** 自定义空状态文案 */
  emptyTitle?: string;
  emptyHint?: string;
}

interface StageDef {
  key: string;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STAGES: StageDef[] = [
  { key: 'backup', title: '备份数据', description: '将 mp_preset_registry 全量 dump 到对象存储', icon: <IconFile /> },
  { key: 'migrate', title: '迁移 schema', description: '应用 v2.0 列变更与索引重建 (idx_preset_category)', icon: <IconBranch /> },
  { key: 'verify', title: '验证数据', description: '对比行数、checksum、RLS 策略完整性', icon: <IconShield /> },
  { key: 'edge', title: '更新 Edge Functions', description: '重新部署 mp-preset-search / mp-preset-install', icon: <IconServer /> },
  { key: 'done', title: '完成', description: '写入 mp_audit_log + Realtime 广播', icon: <IconPulse /> },
];

const STAGE_WEIGHTS = [10, 30, 20, 25, 15]; // 5 阶段权重, 总和 100

function inferStageFromProgress(progress: number): number {
  let acc = 0;
  for (let i = 0; i < STAGE_WEIGHTS.length; i++) {
    acc += STAGE_WEIGHTS[i];
    if (progress < acc) return i;
  }
  return STAGES.length - 1;
}

function inferProgressFromElapsed(elapsed: number, total: number): number {
  if (total <= 0) return 0;
  const ratio = elapsed / total;
  // 用 ease-in-out 模拟真实升级: 起步慢、中段快、收尾稳
  const eased = ratio < 0.5 ? 2 * ratio * ratio : 1 - Math.pow(-2 * ratio + 2, 2) / 2;
  return Math.min(100, Math.max(0, eased * 100));
}

function formatHMS(totalSeconds: number): { h: string; m: string; s: string } {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return {
    h: h.toString().padStart(2, '0'),
    m: m.toString().padStart(2, '0'),
    s: s.toString().padStart(2, '0'),
  };
}

// 主图标: 外圈旋转齿轮 + 内圈脉动 — 使用纯 CSS keyframes
const heroIconCss = `
@keyframes mp-upgrade-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes mp-upgrade-pulse {
  0%, 100% { transform: scale(1);   opacity: 0.85; }
  50%      { transform: scale(1.08); opacity: 1;    }
}
@keyframes mp-upgrade-orbit {
  0%   { transform: rotate(0deg)   translateX(0); }
  50%  { transform: rotate(180deg) translateX(0); }
  100% { transform: rotate(360deg) translateX(0); }
}
.mp-upgrade-hero {
  position: relative;
  width: 128px;
  height: 128px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mp-upgrade-hero .ring {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  border: 2px dashed var(--semi-color-primary);
  opacity: 0.35;
  animation: mp-upgrade-spin 12s linear infinite;
}
.mp-upgrade-hero .ring.inner {
  inset: 14px;
  border-style: dotted;
  border-color: var(--semi-color-primary-hover);
  opacity: 0.55;
  animation: mp-upgrade-spin 6s linear infinite reverse;
}
.mp-upgrade-hero .core {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: radial-gradient(circle at 30% 30%, var(--semi-color-primary-light-active), var(--semi-color-primary));
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 8px 24px rgba(38, 100, 235, 0.35);
  animation: mp-upgrade-pulse 2.4s ease-in-out infinite;
}
.mp-upgrade-hero .orbit {
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--semi-color-primary);
  box-shadow: 0 0 12px var(--semi-color-primary-light-active);
  top: 50%;
  left: 50%;
  margin: -8px 0 0 -8px;
  transform-origin: 8px 8px;
  animation: mp-upgrade-orbit 4s linear infinite;
}
.mp-upgrade-hero .orbit.delay { animation-delay: -2s; opacity: 0.6; }
`;

// 单个阶段 Item 的 CSS (用于 Timeline 内部自定义)
const stageCss = `
.mp-stage-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 4px 0;
}
.mp-stage-row .badge {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--semi-color-fill-0);
  color: var(--semi-color-text-2);
  font-weight: 600;
}
.mp-stage-row .badge.running {
  background: var(--semi-color-primary-light-default);
  color: var(--semi-color-primary);
}
.mp-stage-row .badge.done {
  background: var(--semi-color-success-light-default);
  color: var(--semi-color-success);
}
.mp-stage-row .badge.error {
  background: var(--semi-color-danger-light-default);
  color: var(--semi-color-danger);
}
.mp-stage-row .body { flex: 1; min-width: 0; }
.mp-stage-row .body .title { font-weight: 600; font-size: 14px; }
.mp-stage-row .body .desc { font-size: 12px; color: var(--semi-color-text-2); margin-top: 2px; }
.mp-stage-row .body .meta { font-size: 12px; color: var(--semi-color-text-2); margin-top: 4px; }
`;

let injectedStyle = false;
function injectStyles() {
  if (injectedStyle || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.setAttribute('data-mp-upgrade', 'true');
  style.innerHTML = heroIconCss + stageCss;
  document.head.appendChild(style);
  injectedStyle = true;
}

interface StageStatusRowProps {
  stage: StageDef;
  index: number;
  status: 'pending' | 'running' | 'done' | 'error';
  detail?: string;
}

function StageStatusRow({ stage, index, status, detail }: StageStatusRowProps) {
  const badgeClass =
    status === 'running' ? 'badge running' :
    status === 'done'    ? 'badge done' :
    status === 'error'   ? 'badge error' :
    'badge';

  const badgeContent =
    status === 'done'    ? <IconCheckCircleStroked size="small" /> :
    status === 'running' ? <IconSpin spin /> :
    status === 'error'   ? <IconClose size="small" /> :
    (index + 1);

  const tagColor =
    status === 'running' ? 'blue' :
    status === 'done'    ? 'green' :
    status === 'error'   ? 'red' :
    'grey';

  const tagText =
    status === 'running' ? 'running' :
    status === 'done'    ? 'done' :
    status === 'error'   ? 'error' :
    'pending';

  return (
    <div className="mp-stage-row" data-stage={stage.key} data-stage-status={status}>
      <div className={badgeClass}>{badgeContent}</div>
      <div className="body">
        <div className="title">{stage.title} <Tag color={tagColor} style={{ marginLeft: 8 }}>{tagText}</Tag></div>
        <div className="desc">{stage.description}</div>
        {detail && <div className="meta">{detail}</div>}
      </div>
    </div>
  );
}

export default function MarketplaceUpgrade({
  mode,
  startedAt,
  estimatedSeconds = 1800,
  progress,
  currentStage,
  stageError,
  onRetry,
  emptyTitle,
  emptyHint,
}: MarketplaceUpgradeProps) {
  const navigate = useNavigate();
  injectStyles();

  // ---------- Loading state ----------
  if (mode === 'loading') {
    return (
      <div>
        <PageHeader title="M05 mp-skill-marketplace" description="数字员工 (dsh preset) 市场" />
        <Card>
          <div style={{ padding: 80, textAlign: 'center' }}>
            <IconSpin size="large" style={{ color: 'var(--semi-color-primary)' }} spin />
            <div style={{ marginTop: 16, color: 'var(--semi-color-text-2)' }}>正在加载 marketplace 数据…</div>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- Empty state ----------
  if (mode === 'empty') {
    return (
      <div>
        <PageHeader title="M05 mp-skill-marketplace" description="数字员工 (dsh preset) 市场" />
        <Card>
          <div style={{ padding: 80, textAlign: 'center' }}>
            <div className="mp-upgrade-hero" style={{ width: 96, height: 96 }}>
              <div className="ring" />
              <div className="ring inner" />
              <div className="core" style={{ width: 56, height: 56 }}>
                <IconAppCenter size="large" />
              </div>
            </div>
            <Title heading={4} style={{ marginTop: 24 }}>
              {emptyTitle ?? 'Marketplace 暂无 preset'}
            </Title>
            <Paragraph type="tertiary" style={{ marginTop: 8 }}>
              {emptyHint ?? '等待运营录入第一批 preset · 或联系 #mp-skill-marketplace 申请上架'}
            </Paragraph>
            <Space style={{ marginTop: 16 }}>
              <Button theme="solid" type="primary" icon={<IconAppCenter />} onClick={() => navigate('/admin/ontology')}>
                去 Ontology 注册新 preset
              </Button>
              <Button icon={<IconHistory />} onClick={() => navigate('/')}>返回 Dashboard</Button>
            </Space>
          </div>
        </Card>
      </div>
    );
  }

  // ---------- Upgrading state ----------
  const start = useMemo(() => startedAt ? new Date(startedAt).getTime() : Date.now() - 30 * 60 * 1000, [startedAt]);

  const [now, setNow] = useState<number>(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const elapsedSec = Math.max(0, Math.floor((now - start) / 1000));
  const remainingSec = Math.max(0, estimatedSeconds - elapsedSec);
  const etaHMS = formatHMS(remainingSec);

  const computedProgress = progress ?? inferProgressFromElapsed(elapsedSec, estimatedSeconds);
  const safeProgress = Math.min(100, Math.max(0, computedProgress));
  const computedStage = currentStage ?? inferStageFromProgress(safeProgress);

  // 阶段状态派生
  const stageStatuses = STAGES.map((s, i) => {
    if (stageError && stageError.stage === i) return 'error' as const;
    if (i < computedStage) return 'done' as const;
    if (i === computedStage) return 'running' as const;
    return 'pending' as const;
  });

  // 各阶段细节
  const stageDetails = STAGES.map((s, i) => {
    const w = STAGE_WEIGHTS[i];
    if (i < computedStage) {
      // 已完成: 显示完成时间
      const stageEnd = Math.min(100, STAGE_WEIGHTS.slice(0, i + 1).reduce((a, b) => a + b, 0));
      return `已完成 · 贡献 ${w}% · 累计 ${stageEnd}%`;
    }
    if (i === computedStage) {
      const stageStart = STAGE_WEIGHTS.slice(0, i).reduce((a, b) => a + b, 0);
      const local = safeProgress - stageStart;
      const localPct = Math.min(100, Math.max(0, Math.round((local / w) * 100)));
      return `进行中 · ${localPct}% · 权重 ${w}%`;
    }
    return `等待开始 · 权重 ${w}%`;
  });

  const isError = !!stageError;
  const statusTag = isError
    ? <Tag color="red">升级中断</Tag>
    : safeProgress >= 100
      ? <Tag color="green">已完成</Tag>
      : <Tag color="blue">升级中</Tag>;

  return (
    <div data-testid="marketplace-upgrade-view">
      <PageHeader
        title="M05 mp-skill-marketplace"
        description="数字员工 (dsh preset) 市场 · 升级维护中"
        extra={statusTag}
      />

      <Banner
        type={isError ? 'danger' : 'warning'}
        icon={null}
        title={<strong>维护通知 · mp-skill-marketplace v2.0 升级</strong>}
        description="preset 注册表迁移到 v2.0 schema (新增 manifest_url / runtime_profile / installs_count), 同时重建 RLS 策略并刷新 2 个 Edge Functions。升级期间 preset 市场只读, 仍可浏览历史清单。"
        style={{ marginBottom: 20 }}
      />

      {/* Hero */}
      <Card style={{ marginBottom: 20 }}>
        <div style={{ padding: '40px 20px', textAlign: 'center' }}>
          <div className="mp-upgrade-hero" data-testid="upgrade-hero">
            <div className="ring" />
            <div className="ring inner" />
            <div className="orbit" />
            <div className="orbit delay" />
            <div className="core">
              <IconHandle size="extra-large" />
            </div>
          </div>
          <Title heading={2} style={{ marginTop: 24, marginBottom: 8 }}>
            Marketplace 正在升级中
          </Title>
          <Text type="tertiary" style={{ fontSize: 14, display: 'block' }}>
            mp-skill-marketplace v2.0 · 数据迁移 / Schema 重构 / Edge Functions 刷新
          </Text>

          <div style={{ marginTop: 32, maxWidth: 720, marginLeft: 'auto', marginRight: 'auto' }}>
            <Progress
              percent={safeProgress}
              showInfo
              strokeWidth={10}
              stroke={isError ? 'var(--semi-color-danger)' : safeProgress >= 100 ? 'var(--semi-color-success)' : 'var(--semi-color-primary)'}
              style={{ marginBottom: 16 }}
            />
            <Space spacing="loose" wrap>
              <Stat title="已耗时" value={`${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒`} valueStyle={{ color: 'primary', fontSize: 18 }} />
              <Stat title="预计剩余" value={`${etaHMS.h}:${etaHMS.m}:${etaHMS.s}`} valueStyle={{ color: 'orange', fontSize: 18 }} />
              <Stat
                title="预计完成"
                value={new Date(now + remainingSec * 1000).toLocaleTimeString('zh-CN', { hour12: false })}
                valueStyle={{ color: 'green', fontSize: 18 }}
              />
              <Stat
                title="当前阶段"
                value={`${computedStage + 1} / ${STAGES.length}  ·  ${STAGES[computedStage].title}`}
                valueStyle={{ color: 'primary', fontSize: 18 }}
              />
            </Space>
          </div>
        </div>
      </Card>

      {/* Stage Timeline + Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16, marginBottom: 20 }}>
        <Card title="升级阶段" headerExtraContent={<Tag color="blue">5 阶段</Tag>}>
          <Timeline>
            {STAGES.map((s, i) => (
              <Timeline.Item
                key={s.key}
                type={stageStatuses[i] === 'error' ? 'error' : stageStatuses[i] === 'done' ? 'success' : stageStatuses[i] === 'running' ? 'ongoing' : 'default'}
              >
                <StageStatusRow stage={s} index={i} status={stageStatuses[i]} detail={stageDetails[i]} />
              </Timeline.Item>
            ))}
          </Timeline>
        </Card>

        <Card title="实时指标">
          <Space vertical spacing="loose" style={{ width: '100%' }}>
            <Card><Stat title="已迁移 preset" value={`${Math.round((safeProgress / 100) * 218)} / 218`} valueStyle={{ color: 'green' }} /></Card>
            <Card><Stat title="已重写 Edge Function" value={`${Math.min(2, Math.floor(safeProgress / 50))} / 2`} valueStyle={{ color: 'primary' }} /></Card>
            <Card><Stat title="数据 checksum 通过率" value={`${(99.6 + safeProgress / 1000).toFixed(2)}%`} valueStyle={{ color: 'green' }} /></Card>
            <Card><Stat title="RLS 策略重建" value={`${Math.min(7, Math.floor((safeProgress / 100) * 7))} / 7`} valueStyle={{ color: 'orange' }} /></Card>
          </Space>
        </Card>
      </div>

      {/* Actions */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <Title heading={5} style={{ margin: 0 }}>推荐操作</Title>
            <Text type="tertiary" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
              升级期间 preset 列表只读, 安装/编辑入口已临时关闭
            </Text>
          </div>
          <Space>
            <Button icon={<IconHistory />} onClick={() => navigate('/admin/audit')}>查看升级 audit</Button>
            <Button onClick={() => navigate('/')}>返回 Dashboard</Button>
            {onRetry && (
              <Button theme="solid" type="primary" onClick={onRetry}>手动重试</Button>
            )}
          </Space>
        </div>
      </Card>
    </div>
  );
}