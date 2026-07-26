import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from '@decky/ui';
import { definePlugin } from '@decky/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FaNetworkWired } from 'react-icons/fa';
import { getHistory, getPreferences, saveHistory, savePreferences } from './backend';
import {
  COLORS,
  HistoryView,
  MetricsGrid,
  PhaseProgress,
  SettingsView,
  StatusPill,
} from './components';
import {
  DEFAULT_PREFERENCES,
  HistoryRecord,
  Preferences,
  SERVER_BY_ID,
  ServerId,
  SpeedTestResult,
  TestPhase,
  TestStatus,
  createEmptyResult,
  formatMeasuredAt,
  formatProtocol,
} from './model';
import {
  UniversitySpeedTest,
  countSuccessfulNodes,
  getChartData,
} from './speedtest';

const PLUGIN_VERSION = '2.0.4';

const phaseLabels: Record<TestPhase, string> = {
  idle: '准备测速',
  latency: '正在测试延迟',
  download: '正在测试下载',
  upload: '正在测试上传',
  done: '节点测速完成',
};

function Content() {
  const [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [status, setStatus] = useState<TestStatus>('idle');
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [result, setResult] = useState<SpeedTestResult>(
    createEmptyResult(DEFAULT_PREFERENCES)
  );
  const [currentServerId, setCurrentServerId] = useState<ServerId | null>(null);
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const engineRef = useRef<UniversitySpeedTest | null>(null);
  const preferencesRevisionRef = useRef(0);
  const componentMountedRef = useRef(true);

  useEffect(() => {
    let mounted = true;
    componentMountedRef.current = true;

    Promise.all([getPreferences(), getHistory()])
      .then(([storedPreferences, storedHistory]) => {
        if (!mounted) return;
        setPreferences(storedPreferences);
        setResult(createEmptyResult(storedPreferences));
        setHistory(storedHistory);
      })
      .catch((error) => {
        if (!mounted) return;
        console.error('University Speed Test: failed to load stored data', error);
        setSaveError('无法读取已保存的设置');
      })
      .finally(() => {
        if (!mounted) return;
        setPreferencesReady(true);
        setHistoryLoading(false);
      });

    return () => {
      mounted = false;
      componentMountedRef.current = false;
      engineRef.current?.stop();
    };
  }, []);

  const persistHistory = useCallback((completedResult: SpeedTestResult) => {
    const record: HistoryRecord = {
      ...completedResult,
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    };

    saveHistory(record)
      .then((storedRecord) => {
        if (!componentMountedRef.current) return;
        setHistory((current) => [
          storedRecord,
          ...current.filter((entry) => entry.id !== storedRecord.id),
        ].slice(0, 50));
      })
      .catch((error) => {
        console.error('University Speed Test: failed to save history', error);
      });
  }, []);

  const startTest = useCallback(() => {
    if (!preferencesReady || status === 'running') return;

    engineRef.current?.stop();
    setResult(createEmptyResult(preferences));
    setStatus('running');
    setPhase('latency');
    setProgress(0);
    setErrorMessage(null);
    setCurrentServerId(
      preferences.mode === 'single'
        ? preferences.singleServer
        : preferences.selectedServers[0] ?? null
    );

    const engine = new UniversitySpeedTest(preferences, {
      onProgress(update) {
        if (!componentMountedRef.current) return;
        setResult(update.result);
        setPhase(update.phase);
        setCurrentServerId(update.currentServerId);
        setProgress(update.progress);
      },
      onComplete(completedResult) {
        if (!componentMountedRef.current) return;
        setResult(completedResult);
        setStatus('finished');
        setPhase('done');
        setProgress(1);
        setCurrentServerId(null);
        persistHistory(completedResult);
      },
      onError(message, partialResult) {
        if (!componentMountedRef.current) return;
        setResult(partialResult);
        setStatus('error');
        setPhase('done');
        setCurrentServerId(null);
        setErrorMessage(message);
      },
      onCancelled(partialResult) {
        if (!componentMountedRef.current) return;
        setResult(partialResult);
        setStatus('idle');
        setPhase('idle');
        setProgress(0);
        setCurrentServerId(null);
      },
    });

    engineRef.current = engine;
    void engine.start();
  }, [persistHistory, preferences, preferencesReady, status]);

  const stopTest = useCallback(() => {
    engineRef.current?.stop();
  }, []);

  const updatePreferences = useCallback((nextPreferences: Preferences) => {
    const revision = preferencesRevisionRef.current + 1;
    preferencesRevisionRef.current = revision;
    setPreferences(nextPreferences);
    setResult(createEmptyResult(nextPreferences));
    setStatus('idle');
    setPhase('idle');
    setProgress(0);
    setErrorMessage(null);
    setSaveError(null);

    savePreferences(nextPreferences)
      .then((storedPreferences) => {
        if (
          !componentMountedRef.current ||
          preferencesRevisionRef.current !== revision
        ) {
          return;
        }
        setPreferences(storedPreferences);
      })
      .catch((error) => {
        if (
          !componentMountedRef.current ||
          preferencesRevisionRef.current !== revision
        ) {
          return;
        }
        console.error('University Speed Test: failed to save preferences', error);
        setSaveError('设置保存失败，请重试');
      });
  }, []);

  const downloadChart = useMemo(() => getChartData(result, 'download'), [result]);
  const uploadChart = useMemo(() => getChartData(result, 'upload'), [result]);
  const successfulNodes = countSuccessfulNodes(result);
  const failedNodes = result.nodes.filter((node) => node.status === 'error').length;
  const failedNodeNames = result.nodes
    .filter((node) => node.status === 'error')
    .map((node) => SERVER_BY_ID[node.serverId].shortName)
    .join('、');

  const selectedServerLabel = useMemo(() => {
    if (status === 'running' && currentServerId) {
      return `${SERVER_BY_ID[currentServerId].shortName} · ${SERVER_BY_ID[currentServerId].city}`;
    }
    if (preferences.mode === 'single') {
      const server = SERVER_BY_ID[preferences.singleServer];
      return `${server.shortName} · ${server.city}`;
    }
    return preferences.selectedServers
      .map((serverId) => SERVER_BY_ID[serverId].shortName)
      .join(' + ');
  }, [currentServerId, preferences, status]);

  const progressLabel =
    status === 'running' && currentServerId
      ? `${SERVER_BY_ID[currentServerId].shortName} · ${phaseLabels[phase]}`
      : phaseLabels[phase];

  if (!preferencesReady) {
    return <PanelSection title="正在加载" spinner />;
  }

  return (
    <div>
      <PanelSection title="网络测速">
        <PanelSectionRow>
          <ButtonItem
            layout="below"
            onClick={status === 'running' ? stopTest : startTest}>
            {status === 'running'
              ? '停止测速'
              : status === 'finished' || status === 'error'
                ? '重新测速'
                : '开始测速'}
          </ButtonItem>
        </PanelSectionRow>

        <PanelSectionRow>
          <div style={{ width: '100%' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '8px',
              }}>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ fontSize: '11px', color: COLORS.muted, marginBottom: '3px' }}>
                  {status === 'running' ? '当前测速节点' : '测速节点'}
                </div>
                <div
                  style={{
                    fontSize: '14px',
                    fontWeight: 600,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                  {selectedServerLabel}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  flexWrap: 'wrap',
                  gap: '5px',
                }}>
                <StatusPill tone={preferences.mode === 'average' ? 'blue' : 'neutral'}>
                  {preferences.mode === 'average' ? '多节点平均' : '单节点'}
                </StatusPill>
                <StatusPill>{formatProtocol(preferences.protocol)}</StatusPill>
              </div>
            </div>
          </div>
        </PanelSectionRow>

        <MetricsGrid
          metrics={result}
          downloadChart={downloadChart}
          uploadChart={uploadChart}
        />

        {status === 'running' && (
          <PhaseProgress progress={progress} label={progressLabel} />
        )}

        {status === 'finished' && (
          <>
            <PanelSectionRow>
              <div
                style={{
                  width: '100%',
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: '8px',
                  fontSize: '11px',
                  color: COLORS.muted,
                }}>
                <span>
                  {result.mode === 'average'
                    ? `${successfulNodes}/${result.serverIds.length} 个节点计入平均`
                    : '测速完成'}
                  {failedNodes > 0 ? ` · ${failedNodes} 个失败` : ''}
                </span>
                <span>{formatMeasuredAt(result.measuredAt)}</span>
              </div>
            </PanelSectionRow>
            {failedNodes > 0 && (
              <PanelSectionRow>
                <div
                  style={{
                    width: '100%',
                    padding: '7px 9px',
                    borderRadius: '6px',
                    color: COLORS.red,
                    background: `${COLORS.red}12`,
                    fontSize: '11px',
                    lineHeight: 1.45,
                  }}>
                  {failedNodeNames}连接失败，平均值仅包含成功节点
                </div>
              </PanelSectionRow>
            )}
          </>
        )}

        {status === 'error' && (
          <PanelSectionRow>
            <div
              style={{
                width: '100%',
                padding: '8px 10px',
                borderRadius: '6px',
                color: COLORS.red,
                background: `${COLORS.red}12`,
                fontSize: '12px',
                lineHeight: 1.45,
              }}>
              {errorMessage ?? '测速失败，请检查网络连接'}
            </div>
          </PanelSectionRow>
        )}

        {status === 'idle' && (
          <PanelSectionRow>
            <div
              style={{
                width: '100%',
                textAlign: 'center',
                color: COLORS.muted,
                fontSize: '11px',
              }}>
              测速会产生较大网络流量，建议停止下载后开始
            </div>
          </PanelSectionRow>
        )}

      </PanelSection>

      <SettingsView
        preferences={preferences}
        disabled={status === 'running'}
        saveError={saveError}
        version={PLUGIN_VERSION}
        onChange={updatePreferences}
      />

      <HistoryView history={history} loading={historyLoading} />
    </div>
  );
}

export default definePlugin(() => {
  console.log('University Speed Test plugin initializing');

  return {
    name: 'decky-speed-test-China',
    titleView: <div className={staticClasses.Title}>高校测速</div>,
    content: <Content />,
    icon: <FaNetworkWired />,
    onDismount() {
      console.log('University Speed Test plugin unloading');
    },
  };
});
