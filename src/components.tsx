import {
  DialogButton,
  DropdownItem,
  PanelSection,
  PanelSectionRow,
  ProgressBar,
  SliderField,
  ToggleField,
} from '@decky/ui';
import { FC, useEffect, useRef, useState } from 'react';
import {
  HistoryRecord,
  NetworkProtocol,
  Preferences,
  SERVER_BY_ID,
  SERVER_DEFINITIONS,
  ServerId,
  SpeedMetrics,
  formatLatency,
  formatMeasuredAt,
  formatProtocol,
  formatSpeed,
} from './model';

const COLORS = {
  muted: '#8b929a',
  blue: '#1a9fff',
  orange: '#f5a623',
  purple: '#9b59b6',
  green: '#65c466',
  red: '#ff6464',
  card: 'rgba(255, 255, 255, 0.055)',
  border: 'rgba(255, 255, 255, 0.08)',
};

const useAnimatedValue = (
  targetValue: number | null,
  duration: number = 500
): number | null => {
  const [displayValue, setDisplayValue] = useState<number | null>(targetValue);
  const animationRef = useRef<number | null>(null);

  useEffect(() => {
    if (targetValue === null) {
      setDisplayValue(null);
      return;
    }

    const startValue = displayValue ?? 0;
    const startedAt = performance.now();
    const animate = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayValue(startValue + (targetValue - startValue) * eased);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationRef.current !== null) cancelAnimationFrame(animationRef.current);
    };
  }, [targetValue, duration]);

  return displayValue;
};

const AnimatedNumber: FC<{
  value: number | null;
  format: (value: number | null) => string;
}> = ({ value, format }) => {
  const animatedValue = useAnimatedValue(value);
  return <>{format(animatedValue)}</>;
};

export const MetricDisplay: FC<{
  label: string;
  value: number | null;
  format: (value: number | null) => string;
  unit: string;
  subValues?: { download?: number | null; upload?: number | null };
  reserveSubValueSpace?: boolean;
}> = ({ label, value, format, unit, subValues, reserveSubValueSpace }) => {
  const hasSubValues =
    subValues && (subValues.download !== null || subValues.upload !== null);
  const showSubValueArea = hasSubValues || reserveSubValueSpace;

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '12px', color: COLORS.muted, marginBottom: '2px' }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span style={{ fontSize: '28px', fontWeight: 700 }}>
          <AnimatedNumber value={value} format={format} />
        </span>
        <span style={{ fontSize: '14px', color: COLORS.muted, marginLeft: '4px' }}>
          {unit}
        </span>
      </div>
      {showSubValueArea && (
        <div style={{ marginTop: '4px', fontSize: '12px', minHeight: '36px' }}>
          {subValues?.download !== null && subValues?.download !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
              <span style={{ color: COLORS.orange, marginRight: '4px' }}>↓</span>
              <span style={{ color: COLORS.muted }}>
                <AnimatedNumber value={subValues.download} format={format} /> {unit}
              </span>
            </div>
          )}
          {subValues?.upload !== null && subValues?.upload !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: COLORS.purple, marginRight: '4px' }}>↑</span>
              <span style={{ color: COLORS.muted }}>
                <AnimatedNumber value={subValues.upload} format={format} /> {unit}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export const SpeedChart: FC<{
  points: number[];
  percentile90: number;
  color: string;
  height?: number;
  width?: number;
}> = ({ points, percentile90, color, height = 60, width = 140 }) => {
  const padding = { top: 5, right: 5, bottom: 5, left: 0 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const targetMax = Math.max(...points, percentile90, 1) * 1.1;
  const dataMax = useAnimatedValue(targetMax) ?? targetMax;

  if (points.length < 2) return null;

  const getX = (index: number, total: number) =>
    padding.left + (index / Math.max(1, total - 1)) * chartWidth;
  const getY = (value: number) =>
    padding.top + chartHeight - (value / Math.max(1, dataMax)) * chartHeight;

  const createSmoothPath = (values: number[]): string => {
    const total = values.length;
    let path = `M ${getX(0, total).toFixed(1)} ${getY(values[0]).toFixed(1)}`;

    for (let index = 0; index < total - 1; index += 1) {
      const previousIndex = Math.max(0, index - 1);
      const nextIndex = index + 1;
      const followingIndex = Math.min(total - 1, index + 2);
      const previous = {
        x: getX(previousIndex, total),
        y: getY(values[previousIndex]),
      };
      const current = { x: getX(index, total), y: getY(values[index]) };
      const next = { x: getX(nextIndex, total), y: getY(values[nextIndex]) };
      const following = {
        x: getX(followingIndex, total),
        y: getY(values[followingIndex]),
      };
      const tension = 0.3;

      path += ` C ${(current.x + (next.x - previous.x) * tension).toFixed(1)} ${(
        current.y +
        (next.y - previous.y) * tension
      ).toFixed(1)}, ${(next.x - (following.x - current.x) * tension).toFixed(1)} ${(
        next.y -
        (following.y - current.y) * tension
      ).toFixed(1)}, ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
    }

    return path;
  };

  const smoothPath = createSmoothPath(points);
  const lastX = getX(points.length - 1, points.length);
  const bottom = padding.top + chartHeight;
  const areaPath = `${smoothPath} L ${lastX.toFixed(1)} ${bottom.toFixed(
    1
  )} L ${padding.left.toFixed(1)} ${bottom.toFixed(1)} Z`;
  const percentileY = getY(percentile90);
  const gradientId = `speed-gradient-${color.replace('#', '')}`;

  return (
    <svg width={width} height={height} style={{ display: 'block' }} aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} />
      <line
        x1={padding.left}
        y1={percentileY}
        x2={width - padding.right}
        y2={percentileY}
        stroke={COLORS.muted}
        strokeWidth="1"
        strokeDasharray="3,3"
        opacity="0.5"
      />
      <text
        x={padding.left + 2}
        y={percentileY - 3}
        fontSize="8"
        fill={COLORS.muted}
        opacity="0.7">
        90th
      </text>
      <path
        d={smoothPath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point, index) => (
        <circle
          key={`${index}-${point}`}
          cx={getX(index, points.length)}
          cy={getY(point)}
          r="2"
          fill={color}
        />
      ))}
    </svg>
  );
};

export const MetricsGrid: FC<{
  metrics: SpeedMetrics;
  downloadChart: { points: number[]; percentile90: number };
  uploadChart: { points: number[]; percentile90: number };
}> = ({ metrics, downloadChart, uploadChart }) => (
  <PanelSectionRow>
    <div style={{ width: '100%', display: 'flex', gap: '4px' }}>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <MetricDisplay
          label="下载"
          value={metrics.download}
          format={formatSpeed}
          unit="Mbps"
        />
        <div style={{ height: '60px' }}>
          <SpeedChart
            points={downloadChart.points}
            percentile90={downloadChart.percentile90}
            color={COLORS.orange}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <MetricDisplay
            label="延迟"
            value={metrics.latency}
            format={formatLatency}
            unit="ms"
            subValues={{
              download: metrics.downloadLatency,
              upload: metrics.uploadLatency,
            }}
            reserveSubValueSpace
          />
        </div>
      </div>
      <div style={{ flex: 1, textAlign: 'left' }}>
        <MetricDisplay
          label="上传"
          value={metrics.upload}
          format={formatSpeed}
          unit="Mbps"
        />
        <div style={{ height: '60px' }}>
          <SpeedChart
            points={uploadChart.points}
            percentile90={uploadChart.percentile90}
            color={COLORS.purple}
          />
        </div>
        <div style={{ marginTop: '12px' }}>
          <MetricDisplay
            label="抖动"
            value={metrics.jitter}
            format={formatLatency}
            unit="ms"
            subValues={{
              download: metrics.downloadJitter,
              upload: metrics.uploadJitter,
            }}
            reserveSubValueSpace
          />
        </div>
      </div>
    </div>
  </PanelSectionRow>
);

export const StatusPill: FC<{
  children: string;
  tone?: 'neutral' | 'blue' | 'green' | 'red';
}> = ({ children, tone = 'neutral' }) => {
  const color =
    tone === 'blue'
      ? COLORS.blue
      : tone === 'green'
        ? COLORS.green
        : tone === 'red'
          ? COLORS.red
          : COLORS.muted;

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: '20px',
        padding: '0 7px',
        borderRadius: '10px',
        fontSize: '10px',
        fontWeight: 700,
        color,
        background: `${color}18`,
        border: `1px solid ${color}35`,
      }}>
      {children}
    </span>
  );
};

const protocolValues: NetworkProtocol[] = ['auto', 'ipv4', 'ipv6'];
const modeValues = ['single', 'average'] as const;

const serverOptions = SERVER_DEFINITIONS.map((server) => ({
  data: server.id,
  label: `${server.shortName} · ${server.city}`,
}));

export const SettingsView: FC<{
  preferences: Preferences;
  disabled: boolean;
  saveError: string | null;
  version: string;
  onChange(preferences: Preferences): void;
}> = ({ preferences, disabled, saveError, version, onChange }) => {
  const update = (next: Partial<Preferences>) => {
    onChange({ ...preferences, ...next });
  };

  const updateProtocol = (protocol: NetworkProtocol) => {
    if (protocol !== 'auto') {
      const selectedServers = preferences.selectedServers.filter(
        (serverId) => serverId !== 'nuaa'
      );
      update({
        protocol,
        singleServer: preferences.singleServer === 'nuaa' ? 'ustc' : preferences.singleServer,
        selectedServers: selectedServers.length > 0 ? selectedServers : ['ustc'],
      });
      return;
    }
    update({ protocol });
  };

  const updateSingleServer = (serverId: ServerId) => {
    update({
      singleServer: serverId,
      protocol: serverId === 'nuaa' ? 'auto' : preferences.protocol,
    });
  };

  const toggleServer = (serverId: ServerId, checked: boolean) => {
    let selectedServers = checked
      ? [...preferences.selectedServers, serverId]
      : preferences.selectedServers.filter((selected) => selected !== serverId);
    selectedServers = Array.from(new Set(selectedServers));
    if (selectedServers.length === 0) return;

    update({
      selectedServers,
      protocol: serverId === 'nuaa' && checked && preferences.protocol !== 'auto'
        ? 'auto'
        : preferences.protocol,
    });
  };

  return (
    <>
      <PanelSection title="测速方式">
        <SliderField
          label="结果方式"
          description={
            preferences.mode === 'average'
              ? '依次测试所选节点，再计算成功结果的平均值'
              : '使用一个指定节点完成测速'
          }
          value={modeValues.indexOf(preferences.mode)}
          min={0}
          max={1}
          step={1}
          notchCount={2}
          notchLabels={[
            { notchIndex: 0, label: '单节点', value: 0 },
            { notchIndex: 1, label: '多节点平均', value: 1 },
          ]}
          notchTicksVisible
          showValue={false}
          validValues="steps"
          minimumDpadGranularity={1}
          disabled={disabled}
          onChange={(value) => update({ mode: modeValues[Math.round(value)] })}
        />

        {preferences.mode === 'single' ? (
          <DropdownItem
            label="测速节点"
            description={SERVER_BY_ID[preferences.singleServer].name}
            rgOptions={serverOptions}
            selectedOption={preferences.singleServer}
            disabled={disabled}
            onChange={(option) => updateSingleServer(option.data)}
          />
        ) : (
          SERVER_DEFINITIONS.map((server) => (
            <ToggleField
              key={server.id}
              label={`${server.shortName} · ${server.city}`}
              description={
                server.id === 'nuaa'
                  ? '南京航空航天大学 · 不支持指定 IPv6'
                  : `${server.name} · 支持 IPv4 / IPv6`
              }
              checked={preferences.selectedServers.includes(server.id)}
              disabled={disabled}
              onChange={(checked) => toggleServer(server.id, checked)}
            />
          ))
        )}

        <SliderField
          label="网络协议"
          description={
            preferences.mode === 'single' && preferences.singleServer === 'nuaa'
              ? '南航站点只能使用自动线路'
              : preferences.protocol === 'auto'
              ? '优先使用各节点的 IPv4 线路'
              : `强制使用 ${formatProtocol(preferences.protocol)} 线路`
          }
          value={protocolValues.indexOf(preferences.protocol)}
          min={0}
          max={2}
          step={1}
          notchCount={3}
          notchLabels={[
            { notchIndex: 0, label: '自动', value: 0 },
            { notchIndex: 1, label: 'IPv4', value: 1 },
            { notchIndex: 2, label: 'IPv6', value: 2 },
          ]}
          notchTicksVisible
          showValue={false}
          validValues="steps"
          minimumDpadGranularity={1}
          disabled={
            disabled ||
            (preferences.mode === 'single' && preferences.singleServer === 'nuaa')
          }
          onChange={(value) => updateProtocol(protocolValues[Math.round(value)])}
        />

        {saveError && (
          <PanelSectionRow>
            <div style={{ color: COLORS.red, fontSize: '12px' }}>{saveError}</div>
          </PanelSectionRow>
        )}
      </PanelSection>

      <PanelSection title="节点能力">
        <PanelSectionRow>
          <div style={{ fontSize: '12px', lineHeight: 1.55, color: COLORS.muted }}>
            中科大和南大通过独立域名选择 IPv4 / IPv6。南航使用站点默认线路，选择
            IPv6 时会自动排除。多节点采用顺序测速，避免多个节点同时占满带宽而低估结果。
          </div>
        </PanelSectionRow>
      </PanelSection>

      <PanelSection title="关于">
        <PanelSectionRow>
          <div
            style={{
              width: '100%',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '8px',
              fontSize: '12px',
            }}>
            <span>高校测速</span>
            <StatusPill>{`v${version}`}</StatusPill>
          </div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );
};

const HistoryMetric: FC<{ label: string; value: number | null; unit: string }> = ({
  label,
  value,
  unit,
}) => (
  <div style={{ minWidth: 0 }}>
    <div style={{ fontSize: '10px', color: COLORS.muted }}>{label}</div>
    <div style={{ marginTop: '2px', fontSize: '17px', fontWeight: 700 }}>
      {unit === 'Mbps' ? formatSpeed(value) : formatLatency(value)}
      <span style={{ marginLeft: '3px', color: COLORS.muted, fontSize: '10px' }}>
        {unit}
      </span>
    </div>
  </div>
);

export const HistoryView: FC<{
  history: HistoryRecord[];
  loading: boolean;
}> = ({ history, loading }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return <PanelSection title="历史记录" spinner />;
  }

  if (history.length === 0) {
    return (
      <PanelSection title="历史记录">
        <PanelSectionRow>
          <div
            style={{
              width: '100%',
              padding: '28px 10px',
              textAlign: 'center',
              color: COLORS.muted,
              fontSize: '12px',
            }}>
            完成一次测速后，结果会保存在这里
          </div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <PanelSection title={`历史记录 · ${history.length}`}>
      {history.map((record) => {
        const isExpanded = expandedId === record.id;
        const successfulNodes = record.nodes.filter((node) => node.status === 'success');
        return (
          <PanelSectionRow key={record.id}>
            <DialogButton
              onClick={() => setExpandedId(isExpanded ? null : record.id)}
              style={{
                width: '100%',
                height: 'auto',
                minHeight: '82px',
                padding: '11px 12px',
                textAlign: 'left',
                background: COLORS.card,
                border: `1px solid ${COLORS.border}`,
                borderRadius: '8px',
              }}>
              <div style={{ width: '100%' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '8px',
                  }}>
                  <span style={{ fontSize: '11px', color: COLORS.muted }}>
                    {formatMeasuredAt(record.measuredAt)}
                  </span>
                  <StatusPill tone={record.mode === 'average' ? 'blue' : 'neutral'}>
                    {record.mode === 'average'
                      ? `${successfulNodes.length} 节点平均`
                      : SERVER_BY_ID[record.serverIds[0]]?.shortName ?? '单节点'}
                  </StatusPill>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr 0.8fr',
                    gap: '8px',
                    marginTop: '10px',
                  }}>
                  <HistoryMetric label="下载" value={record.download} unit="Mbps" />
                  <HistoryMetric label="上传" value={record.upload} unit="Mbps" />
                  <HistoryMetric label="延迟" value={record.latency} unit="ms" />
                </div>

                {isExpanded && (
                  <div
                    style={{
                      marginTop: '11px',
                      paddingTop: '9px',
                      borderTop: `1px solid ${COLORS.border}`,
                    }}>
                    {record.nodes.map((node) => (
                      <div
                        key={node.serverId}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1.2fr 0.8fr 0.8fr',
                          gap: '6px',
                          marginTop: '5px',
                          fontSize: '10px',
                          color: node.status === 'error' ? COLORS.red : '#d7d9dd',
                        }}>
                        <span>
                          {SERVER_BY_ID[node.serverId].shortName} ·{' '}
                          {formatProtocol(node.protocol)}
                        </span>
                        <span>↓ {formatSpeed(node.download)}</span>
                        <span>↑ {formatSpeed(node.upload)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </DialogButton>
          </PanelSectionRow>
        );
      })}
    </PanelSection>
  );
};

export const PhaseProgress: FC<{
  progress: number;
  label: string;
}> = ({ progress, label }) => (
  <PanelSectionRow>
    <div style={{ width: '100%' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '6px',
          fontSize: '11px',
          color: COLORS.muted,
        }}>
        <span>{label}</span>
        <span>{Math.round(progress * 100)}%</span>
      </div>
      <ProgressBar nProgress={progress} />
    </div>
  </PanelSectionRow>
);

export { COLORS };
