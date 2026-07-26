import {
  BandwidthMeasurement,
  EMPTY_METRICS,
  NetworkProtocol,
  NodeResult,
  Preferences,
  SERVER_BY_ID,
  ServerId,
  SpeedMetrics,
  SpeedTestResult,
  TestPhase,
  createEmptyResult,
} from './model';
import { measureDownloadSample, measureLatency, measureUploadSample } from './backend';

const DOWNLOAD_SIZES_MB = [1, 4, 8];
const UPLOAD_SIZES_MB = [0.25, 1, 4];
const SLOW_SAMPLE_THRESHOLD_MS = 1_800;

export interface ProgressUpdate {
  result: SpeedTestResult;
  phase: TestPhase;
  currentServerId: ServerId;
  completedServers: number;
  totalServers: number;
  progress: number;
}

interface SpeedTestCallbacks {
  onProgress(update: ProgressUpdate): void;
  onComplete(result: SpeedTestResult): void;
  onError(message: string, partialResult: SpeedTestResult): void;
  onCancelled(partialResult: SpeedTestResult): void;
}

const percentile = (values: number[], amount: number): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.ceil(amount * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
};

const average = (values: Array<number | null>): number | null => {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
};

const aggregateNodes = (
  nodes: NodeResult[],
  preferences: Preferences,
  measuredAt: string | null = null
): SpeedTestResult => {
  const usableNodes = nodes.filter(
    (node) =>
      node.status !== 'error' &&
      (node.download !== null ||
        node.upload !== null ||
        node.latency !== null ||
        node.jitter !== null)
  );

  return {
    download: average(usableNodes.map((node) => node.download)),
    upload: average(usableNodes.map((node) => node.upload)),
    latency: average(usableNodes.map((node) => node.latency)),
    jitter: average(usableNodes.map((node) => node.jitter)),
    downloadLatency: average(usableNodes.map((node) => node.downloadLatency)),
    downloadJitter: average(usableNodes.map((node) => node.downloadJitter)),
    uploadLatency: average(usableNodes.map((node) => node.uploadLatency)),
    uploadJitter: average(usableNodes.map((node) => node.uploadJitter)),
    mode: preferences.mode,
    protocol: preferences.protocol,
    serverIds:
      preferences.mode === 'single'
        ? [preferences.singleServer]
        : [...preferences.selectedServers],
    nodes: nodes.map((node) => ({ ...node })),
    measuredAt,
  };
};

const averageBandwidthLatency = (
  measurements: BandwidthMeasurement[],
  key: 'loadedLatency' | 'loadedJitter'
): number | null => average(measurements.map((measurement) => measurement[key]));

export class UniversitySpeedTest {
  private cancelled = false;

  constructor(
    private readonly preferences: Preferences,
    private readonly callbacks: SpeedTestCallbacks
  ) {}

  stop(): void {
    this.cancelled = true;
  }

  async start(): Promise<void> {
    this.cancelled = false;
    const serverIds =
      this.preferences.mode === 'single'
        ? [this.preferences.singleServer]
        : this.preferences.selectedServers;

    if (serverIds.length === 0) {
      this.callbacks.onError('请至少选择一个测速节点', createEmptyResult(this.preferences));
      return;
    }

    const nodes: NodeResult[] = [];

    for (let serverIndex = 0; serverIndex < serverIds.length; serverIndex += 1) {
      const serverId = serverIds[serverIndex];
      const node = this.createNode(serverId);
      nodes.push(node);

      try {
        await this.testNode(node, nodes, serverIndex, serverIds.length);
        node.status = 'success';
      } catch (error) {
        if (this.cancelled) {
          this.callbacks.onCancelled(aggregateNodes(nodes, this.preferences));
          return;
        }

        node.status = 'error';
        node.error = error instanceof Error ? error.message : String(error);
        this.emitProgress(nodes, 'done', serverId, serverIndex, serverIds.length, 1);
      }

      if (this.cancelled) {
        this.callbacks.onCancelled(aggregateNodes(nodes, this.preferences));
        return;
      }
    }

    const successfulNodes = nodes.filter((node) => node.status === 'success');
    const measuredAt = new Date().toISOString();
    const result = aggregateNodes(nodes, this.preferences, measuredAt);

    if (successfulNodes.length === 0) {
      this.callbacks.onError('所有测速节点均连接失败，请稍后重试', result);
      return;
    }

    this.callbacks.onComplete(result);
  }

  private createNode(serverId: ServerId): NodeResult {
    const definition = SERVER_BY_ID[serverId];
    return {
      ...EMPTY_METRICS,
      serverId,
      serverName: definition.name,
      protocol: this.preferences.protocol,
      baseUrl: null,
      publicIp: null,
      downloadPoints: [],
      uploadPoints: [],
      status: 'running',
    };
  }

  private async testNode(
    node: NodeResult,
    nodes: NodeResult[],
    serverIndex: number,
    totalServers: number
  ): Promise<void> {
    this.emitProgress(nodes, 'latency', node.serverId, serverIndex, totalServers, 0);
    const latency = await measureLatency(node.serverId, this.preferences.protocol);
    this.throwIfCancelled();

    node.latency = latency.latency;
    node.jitter = latency.jitter;
    node.baseUrl = latency.baseUrl;
    node.publicIp = latency.publicIp;
    node.protocol = latency.protocol;
    this.emitProgress(nodes, 'latency', node.serverId, serverIndex, totalServers, 1 / 7);

    const downloadMeasurements: BandwidthMeasurement[] = [];
    for (let index = 0; index < DOWNLOAD_SIZES_MB.length; index += 1) {
      const measurement = await measureDownloadSample(
        node.serverId,
        this.preferences.protocol,
        DOWNLOAD_SIZES_MB[index]
      );
      this.throwIfCancelled();

      downloadMeasurements.push(measurement);
      node.downloadPoints.push(measurement.bps);
      node.download = percentile(node.downloadPoints, 0.9);
      node.downloadLatency = averageBandwidthLatency(
        downloadMeasurements,
        'loadedLatency'
      );
      node.downloadJitter = averageBandwidthLatency(downloadMeasurements, 'loadedJitter');
      this.emitProgress(
        nodes,
        'download',
        node.serverId,
        serverIndex,
        totalServers,
        (2 + index) / 7
      );

      if (measurement.duration >= SLOW_SAMPLE_THRESHOLD_MS) break;
    }

    const uploadMeasurements: BandwidthMeasurement[] = [];
    for (let index = 0; index < UPLOAD_SIZES_MB.length; index += 1) {
      const measurement = await measureUploadSample(
        node.serverId,
        this.preferences.protocol,
        UPLOAD_SIZES_MB[index]
      );
      this.throwIfCancelled();

      uploadMeasurements.push(measurement);
      node.uploadPoints.push(measurement.bps);
      node.upload = percentile(node.uploadPoints, 0.9);
      node.uploadLatency = averageBandwidthLatency(uploadMeasurements, 'loadedLatency');
      node.uploadJitter = averageBandwidthLatency(uploadMeasurements, 'loadedJitter');
      this.emitProgress(
        nodes,
        'upload',
        node.serverId,
        serverIndex,
        totalServers,
        (5 + index) / 7
      );

      if (measurement.duration >= SLOW_SAMPLE_THRESHOLD_MS) break;
    }

    this.emitProgress(nodes, 'done', node.serverId, serverIndex, totalServers, 1);
  }

  private throwIfCancelled(): void {
    if (this.cancelled) {
      throw new Error('测速已停止');
    }
  }

  private emitProgress(
    nodes: NodeResult[],
    phase: TestPhase,
    currentServerId: ServerId,
    completedServers: number,
    totalServers: number,
    nodeProgress: number
  ): void {
    const overallProgress = Math.min(
      1,
      (completedServers + Math.max(0, Math.min(1, nodeProgress))) / totalServers
    );

    this.callbacks.onProgress({
      result: aggregateNodes(nodes, this.preferences),
      phase,
      currentServerId,
      completedServers,
      totalServers,
      progress: overallProgress,
    });
  }
}

export const getChartData = (
  result: SpeedTestResult,
  type: 'download' | 'upload'
): { points: number[]; percentile90: number } => {
  const points = result.nodes.flatMap((node) =>
    type === 'download' ? node.downloadPoints : node.uploadPoints
  );
  return {
    points,
    percentile90: percentile(points, 0.9) ?? 0,
  };
};

export const countSuccessfulNodes = (result: SpeedTestResult): number =>
  result.nodes.filter((node) => node.status === 'success').length;

export const hasAnyMetrics = (metrics: SpeedMetrics): boolean =>
  Object.values(metrics).some((value) => value !== null);

export const describeProtocolForServer = (
  serverId: ServerId,
  protocol: NetworkProtocol
): NetworkProtocol => {
  if (serverId === 'nuaa' && protocol !== 'auto') return 'auto';
  return protocol;
};
