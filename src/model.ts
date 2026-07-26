export type ServerId = 'ustc' | 'nju' | 'nuaa';
export type NetworkProtocol = 'auto' | 'ipv4' | 'ipv6';
export type TestMode = 'single' | 'average';
export type TestStatus = 'idle' | 'running' | 'finished' | 'error';
export type TestPhase = 'idle' | 'latency' | 'download' | 'upload' | 'done';
export type ViewId = 'test' | 'history' | 'settings';

export interface ServerDefinition {
  id: ServerId;
  shortName: string;
  name: string;
  city: string;
  supportsIpv4: boolean;
  supportsIpv6: boolean;
}

export const SERVER_DEFINITIONS: ServerDefinition[] = [
  {
    id: 'ustc',
    shortName: '中科大',
    name: '中国科学技术大学',
    city: '合肥',
    supportsIpv4: true,
    supportsIpv6: true,
  },
  {
    id: 'nju',
    shortName: '南大',
    name: '南京大学',
    city: '南京',
    supportsIpv4: true,
    supportsIpv6: true,
  },
  {
    id: 'nuaa',
    shortName: '南航',
    name: '南京航空航天大学',
    city: '南京',
    supportsIpv4: true,
    supportsIpv6: false,
  },
];

export const SERVER_BY_ID = SERVER_DEFINITIONS.reduce(
  (result, server) => {
    result[server.id] = server;
    return result;
  },
  {} as Record<ServerId, ServerDefinition>
);

export interface Preferences {
  mode: TestMode;
  singleServer: ServerId;
  selectedServers: ServerId[];
  protocol: NetworkProtocol;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: 'single',
  singleServer: 'ustc',
  selectedServers: ['ustc', 'nju', 'nuaa'],
  protocol: 'auto',
};

export interface SpeedMetrics {
  download: number | null;
  upload: number | null;
  latency: number | null;
  jitter: number | null;
  downloadLatency: number | null;
  downloadJitter: number | null;
  uploadLatency: number | null;
  uploadJitter: number | null;
}

export interface NodeResult extends SpeedMetrics {
  serverId: ServerId;
  serverName: string;
  protocol: NetworkProtocol;
  baseUrl: string | null;
  publicIp: string | null;
  downloadPoints: number[];
  uploadPoints: number[];
  status: 'running' | 'success' | 'error';
  error?: string;
}

export interface SpeedTestResult extends SpeedMetrics {
  mode: TestMode;
  protocol: NetworkProtocol;
  serverIds: ServerId[];
  nodes: NodeResult[];
  measuredAt: string | null;
}

export interface HistoryRecord extends SpeedTestResult {
  id: string;
}

export interface ChartData {
  points: number[];
  percentile90: number;
}

export interface LatencyMeasurement {
  latency: number;
  jitter: number;
  baseUrl: string;
  publicIp: string | null;
  protocol: NetworkProtocol;
}

export interface BandwidthMeasurement {
  bps: number;
  bytes: number;
  duration: number;
  loadedLatency: number | null;
  loadedJitter: number | null;
}

export const EMPTY_METRICS: SpeedMetrics = {
  download: null,
  upload: null,
  latency: null,
  jitter: null,
  downloadLatency: null,
  downloadJitter: null,
  uploadLatency: null,
  uploadJitter: null,
};

export const createEmptyResult = (preferences: Preferences): SpeedTestResult => ({
  ...EMPTY_METRICS,
  mode: preferences.mode,
  protocol: preferences.protocol,
  serverIds:
    preferences.mode === 'single'
      ? [preferences.singleServer]
      : [...preferences.selectedServers],
  nodes: [],
  measuredAt: null,
});

export const formatSpeed = (bps: number | null): string => {
  if (bps === null) return '--';
  return (bps / 1_000_000).toFixed(1);
};

export const formatLatency = (ms: number | null): string => {
  if (ms === null) return '--';
  return ms.toFixed(1);
};

export const formatProtocol = (protocol: NetworkProtocol): string => {
  if (protocol === 'ipv4') return 'IPv4';
  if (protocol === 'ipv6') return 'IPv6';
  return '自动';
};

export const formatMeasuredAt = (value: string | null): string => {
  if (!value) return '--';
  const date = new Date(value);
  return date.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
