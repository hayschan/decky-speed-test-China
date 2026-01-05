import { ButtonItem, PanelSection, PanelSectionRow, staticClasses } from '@decky/ui';
import { definePlugin } from '@decky/api';
import { useState, useEffect, useRef, useCallback, FC } from 'react';
import { FaNetworkWired } from 'react-icons/fa';

interface SpeedTestResults {
  download: number | null;
  upload: number | null;
  latency: number | null; // Unloaded baseline latency
  jitter: number | null; // Unloaded baseline jitter
  downloadLatency: number | null; // Loaded latency during download
  downloadJitter: number | null; // Loaded jitter during download
  uploadLatency: number | null; // Loaded latency during upload
  uploadJitter: number | null; // Loaded jitter during upload
  measuredAt: Date | null;
}

type TestStatus = 'idle' | 'running' | 'paused' | 'finished' | 'error';
type TestPhase = 'idle' | 'latency' | 'download' | 'upload' | 'done';

const formatSpeed = (bps: number | null): string => {
  if (bps === null) return '--';
  const mbps = bps / 1_000_000;
  return mbps.toFixed(1);
};

const formatLatency = (ms: number | null): string => {
  if (ms === null) return '--';
  return ms.toFixed(1);
};

const formatTime = (date: Date | null): string => {
  if (date === null) return '--';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
};

// Cloudflare datacenter codes to location names
// See: https://www.cloudflarestatus.com/
const CF_DATACENTERS: Record<string, string> = {
  // North America
  ATL: 'Atlanta, GA',
  BOS: 'Boston, MA',
  BUF: 'Buffalo, NY',
  CLT: 'Charlotte, NC',
  ORD: 'Chicago, IL',
  CMH: 'Columbus, OH',
  DFW: 'Dallas, TX',
  DEN: 'Denver, CO',
  DTW: 'Detroit, MI',
  HNL: 'Honolulu, HI',
  IAH: 'Houston, TX',
  JAX: 'Jacksonville, FL',
  MCI: 'Kansas City, MO',
  LAS: 'Las Vegas, NV',
  LAX: 'Los Angeles, CA',
  MFE: 'McAllen, TX',
  MEM: 'Memphis, TN',
  MIA: 'Miami, FL',
  MSP: 'Minneapolis, MN',
  MGM: 'Montgomery, AL',
  BNA: 'Nashville, TN',
  EWR: 'Newark, NJ',
  ORF: 'Norfolk, VA',
  OMA: 'Omaha, NE',
  PHX: 'Phoenix, AZ',
  PIT: 'Pittsburgh, PA',
  PDX: 'Portland, OR',
  RIC: 'Richmond, VA',
  SMF: 'Sacramento, CA',
  SLC: 'Salt Lake City, UT',
  SAN: 'San Diego, CA',
  SJC: 'San Jose, CA',
  SEA: 'Seattle, WA',
  STL: 'St. Louis, MO',
  TPA: 'Tampa, FL',
  IAD: 'Ashburn, VA',
  YYZ: 'Toronto, CA',
  YVR: 'Vancouver, CA',
  YYC: 'Calgary, CA',
  YUL: 'Montreal, CA',
  QRO: 'Querétaro, MX',
  GDL: 'Guadalajara, MX',
  // Europe
  AMS: 'Amsterdam, NL',
  ATH: 'Athens, GR',
  BCN: 'Barcelona, ES',
  BEG: 'Belgrade, RS',
  TXL: 'Berlin, DE',
  BRU: 'Brussels, BE',
  OTP: 'Bucharest, RO',
  BUD: 'Budapest, HU',
  CPH: 'Copenhagen, DK',
  DUB: 'Dublin, IE',
  DUS: 'Düsseldorf, DE',
  EDI: 'Edinburgh, GB',
  FRA: 'Frankfurt, DE',
  GVA: 'Geneva, CH',
  GOT: 'Gothenburg, SE',
  HAM: 'Hamburg, DE',
  HEL: 'Helsinki, FI',
  KBP: 'Kyiv, UA',
  LIS: 'Lisbon, PT',
  LHR: 'London, GB',
  MAD: 'Madrid, ES',
  MAN: 'Manchester, GB',
  MRS: 'Marseille, FR',
  MXP: 'Milan, IT',
  MUC: 'Munich, DE',
  OSL: 'Oslo, NO',
  CDG: 'Paris, FR',
  PRG: 'Prague, CZ',
  KEF: 'Reykjavik, IS',
  RIX: 'Riga, LV',
  FCO: 'Rome, IT',
  LED: 'St. Petersburg, RU',
  SOF: 'Sofia, BG',
  ARN: 'Stockholm, SE',
  TLL: 'Tallinn, EE',
  VIE: 'Vienna, AT',
  VNO: 'Vilnius, LT',
  WAW: 'Warsaw, PL',
  ZAG: 'Zagreb, HR',
  ZRH: 'Zurich, CH',
  // Asia Pacific
  BKK: 'Bangkok, TH',
  PEK: 'Beijing, CN',
  BLR: 'Bangalore, IN',
  MAA: 'Chennai, IN',
  CKG: 'Chongqing, CN',
  CGK: 'Jakarta, ID',
  HKG: 'Hong Kong',
  HYD: 'Hyderabad, IN',
  KUL: 'Kuala Lumpur, MY',
  CCU: 'Kolkata, IN',
  MNL: 'Manila, PH',
  BOM: 'Mumbai, IN',
  DEL: 'New Delhi, IN',
  KIX: 'Osaka, JP',
  ICN: 'Seoul, KR',
  PVG: 'Shanghai, CN',
  SZX: 'Shenzhen, CN',
  SIN: 'Singapore',
  TPE: 'Taipei, TW',
  NRT: 'Tokyo, JP',
  // Oceania
  AKL: 'Auckland, NZ',
  BNE: 'Brisbane, AU',
  MEL: 'Melbourne, AU',
  PER: 'Perth, AU',
  SYD: 'Sydney, AU',
  // South America
  EZE: 'Buenos Aires, AR',
  LIM: 'Lima, PE',
  SCL: 'Santiago, CL',
  GRU: 'São Paulo, BR',
  BOG: 'Bogotá, CO',
  // Middle East & Africa
  CPT: 'Cape Town, ZA',
  DXB: 'Dubai, AE',
  JNB: 'Johannesburg, ZA',
  TLV: 'Tel Aviv, IL',
};

// Fetch Cloudflare server location from trace endpoint
const fetchCloudflareLocation = async (): Promise<string | null> => {
  try {
    const response = await fetch('https://speed.cloudflare.com/cdn-cgi/trace', {
      cache: 'no-store',
    });
    const text = await response.text();
    // Parse the trace response for colo=XXX
    const coloMatch = text.match(/colo=(\w+)/);
    if (coloMatch) {
      const code = coloMatch[1];
      return CF_DATACENTERS[code] || code;
    }
    return null;
  } catch {
    return null;
  }
};

// Hook for animated number transitions
const useAnimatedValue = (targetValue: number | null, duration: number = 500): number | null => {
  const [displayValue, setDisplayValue] = useState<number | null>(targetValue);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);
  const startValueRef = useRef<number>(0);

  useEffect(() => {
    if (targetValue === null) {
      setDisplayValue(null);
      return;
    }

    const currentDisplay = displayValue ?? 0;
    startValueRef.current = currentDisplay;
    startTimeRef.current = performance.now();

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);

      // Ease out cubic for smooth deceleration
      const eased = 1 - Math.pow(1 - progress, 3);

      const newValue = startValueRef.current + (targetValue - startValueRef.current) * eased;
      setDisplayValue(newValue);

      if (progress < 1) {
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetValue, duration]);

  return displayValue;
};

// Bandwidth measurement point
interface BandwidthPoint {
  bytes: number;
  bps: number;
  duration: number;
}

// Speed test implementation using Cloudflare's methodology:
// - Multiple measurements at progressive sizes
// - 90th percentile for bandwidth calculation
// - Minimum 10ms duration threshold
// - Stop when requests exceed 1000ms
// - Real-time progress updates
class SimpleSpeedTest {
  private abortController: AbortController | null = null;
  private isPaused = false;
  private isRunning = false;

  // Cloudflare methodology constants
  private readonly MIN_DURATION_MS = 10; // Minimum request duration to count
  private readonly MAX_DURATION_MS = 1000; // Stop testing larger sizes after this
  private readonly BANDWIDTH_PERCENTILE = 0.9; // 90th percentile for bandwidth
  private readonly LATENCY_PERCENTILE = 0.5; // 50th percentile (median) for latency

  public onProgress: (results: Partial<SpeedTestResults>, phase: TestPhase) => void = () => {};
  public onComplete: (results: SpeedTestResults) => void = () => {};
  public onError: (error: string) => void = () => {};
  public onChartUpdate: (
    type: 'download' | 'upload',
    points: number[],
    percentile90: number
  ) => void = () => {};

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isPaused = false;
    this.abortController = new AbortController();

    const results: SpeedTestResults = {
      download: null,
      upload: null,
      latency: null,
      jitter: null,
      downloadLatency: null,
      downloadJitter: null,
      uploadLatency: null,
      uploadJitter: null,
      measuredAt: null,
    };

    try {
      // Phase 1: Latency test (20 measurements like Cloudflare)
      this.onProgress(results, 'latency');
      const latencyResults = await this.measureLatency();
      results.latency = latencyResults.latency;
      results.jitter = latencyResults.jitter;
      this.onProgress(results, 'latency');

      if (this.isPaused || this.abortController?.signal.aborted) return;

      // Phase 2: Download test with progressive refinement
      this.onProgress(results, 'download');
      const downloadResult = await this.measureDownload(results);
      results.download = downloadResult.speed;
      results.downloadLatency = downloadResult.latency;
      results.downloadJitter = downloadResult.jitter;
      this.onProgress(results, 'download');

      if (this.isPaused || this.abortController?.signal.aborted) return;

      // Phase 3: Upload test with progressive refinement
      this.onProgress(results, 'upload');
      const uploadResult = await this.measureUpload(results);
      results.upload = uploadResult.speed;
      results.uploadLatency = uploadResult.latency;
      results.uploadJitter = uploadResult.jitter;
      this.onProgress(results, 'upload');

      results.measuredAt = new Date();
      this.onProgress(results, 'done');
      this.onComplete(results);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('Speed test aborted');
      } else {
        console.error('Speed test error:', error);
        this.onError(error instanceof Error ? error.message : String(error));
      }
    } finally {
      this.isRunning = false;
    }
  }

  pause(): void {
    this.isPaused = true;
    this.abortController?.abort();
  }

  resume(): void {
    if (this.isPaused) {
      this.isPaused = false;
      this.start();
    }
  }

  stop(): void {
    this.isPaused = false;
    this.isRunning = false;
    this.abortController?.abort();
  }

  // Calculate percentile from sorted array
  private percentile(sortedArr: number[], p: number): number {
    if (sortedArr.length === 0) return 0;
    const index = Math.ceil(p * sortedArr.length) - 1;
    return sortedArr[Math.max(0, Math.min(index, sortedArr.length - 1))];
  }

  // Calculate bandwidth using 90th percentile (Cloudflare methodology)
  private calculateBandwidth(points: BandwidthPoint[]): number {
    // Filter out measurements that are too short
    const validPoints = points.filter((p) => p.duration >= this.MIN_DURATION_MS);
    if (validPoints.length === 0) return 0;

    const speeds = validPoints.map((p) => p.bps).sort((a, b) => a - b);
    return this.percentile(speeds, this.BANDWIDTH_PERCENTILE);
  }

  private async measureLatency(): Promise<{ latency: number; jitter: number }> {
    const pings: number[] = [];
    const numPings = 20; // Cloudflare uses 20 latency measurements

    for (let i = 0; i < numPings; i++) {
      if (this.abortController?.signal.aborted) break;

      try {
        const start = performance.now();
        await fetch(`https://speed.cloudflare.com/__down?bytes=0&r=${Math.random()}`, {
          signal: this.abortController?.signal,
          cache: 'no-store',
        });
        const duration = performance.now() - start;
        pings.push(duration);
      } catch {
        // Ignore failures
      }

      // Small delay between pings
      await this.sleep(50);
    }

    if (pings.length === 0) {
      return { latency: 0, jitter: 0 };
    }

    // Calculate median latency (50th percentile)
    const sorted = [...pings].sort((a, b) => a - b);
    const latency = this.percentile(sorted, this.LATENCY_PERCENTILE);

    // Calculate jitter (average deviation from median)
    const jitter = pings.reduce((sum, p) => sum + Math.abs(p - latency), 0) / pings.length;

    return { latency, jitter };
  }

  private async measureDownload(
    results: SpeedTestResults
  ): Promise<{ speed: number; latency: number; jitter: number }> {
    // Cloudflare-style progressive test sizes with multiple measurements per size
    // Simplified for Steam Deck but follows same methodology
    const testConfig = [
      { bytes: 100_000, count: 4 }, // 100KB x4
      { bytes: 1_000_000, count: 4 }, // 1MB x4
      { bytes: 5_000_000, count: 3 }, // 5MB x3
      { bytes: 10_000_000, count: 3 }, // 10MB x3
      { bytes: 25_000_000, count: 2 }, // 25MB x2
    ];

    const allMeasurements: BandwidthPoint[] = [];
    const loadedLatencies: number[] = [];
    let shouldStop = false;

    for (const config of testConfig) {
      if (this.abortController?.signal.aborted || shouldStop) break;

      for (let i = 0; i < config.count; i++) {
        if (this.abortController?.signal.aborted || shouldStop) break;

        try {
          // Measure latency concurrently
          const latencyPromise = this.measureSingleLatency();

          const start = performance.now();
          const response = await fetch(
            `https://speed.cloudflare.com/__down?bytes=${config.bytes}&r=${Math.random()}`,
            {
              signal: this.abortController?.signal,
              cache: 'no-store',
            }
          );

          const blob = await response.blob();
          const end = performance.now();
          const duration = end - start;

          const bits = blob.size * 8;
          const bps = bits / (duration / 1000);

          allMeasurements.push({ bytes: config.bytes, bps, duration });

          // Collect loaded latency
          const latency = await latencyPromise;
          if (latency > 0) loadedLatencies.push(latency);

          // Update results in real-time with current 90th percentile
          const currentSpeed = this.calculateBandwidth(allMeasurements);
          results.download = currentSpeed;
          const latencyStats = this.calculateLatencyStats(loadedLatencies);
          results.downloadLatency = latencyStats.latency;
          results.downloadJitter = latencyStats.jitter;
          this.onProgress(results, 'download');

          // Update chart data
          const chartPoints = allMeasurements.map((m) => m.bps);
          this.onChartUpdate('download', chartPoints, currentSpeed);

          console.log(
            `Download: ${(config.bytes / 1_000_000).toFixed(1)}MB #${i + 1} = ${(
              bps / 1_000_000
            ).toFixed(1)} Mbps (${duration.toFixed(0)}ms) | 90th pctl: ${(
              currentSpeed / 1_000_000
            ).toFixed(1)} Mbps`
          );

          // Stop testing larger sizes if this request exceeded threshold
          if (duration > this.MAX_DURATION_MS) {
            console.log(
              `Download: Request took ${duration.toFixed(0)}ms > ${
                this.MAX_DURATION_MS
              }ms, stopping larger tests`
            );
            shouldStop = true;
            break;
          }
        } catch (error) {
          console.error('Download test error:', error);
        }
      }
    }

    const speed = this.calculateBandwidth(allMeasurements);
    const { latency, jitter } = this.calculateLatencyStats(loadedLatencies);

    console.log(
      `Download complete: ${(speed / 1_000_000).toFixed(1)} Mbps (${
        allMeasurements.length
      } measurements)`
    );
    return { speed, latency, jitter };
  }

  private async measureUpload(
    results: SpeedTestResults
  ): Promise<{ speed: number; latency: number; jitter: number }> {
    // Cloudflare-style progressive test sizes for upload
    // Smaller sizes than download due to typical asymmetric connections
    const testConfig = [
      { bytes: 100_000, count: 4 }, // 100KB x4
      { bytes: 500_000, count: 3 }, // 500KB x3
      { bytes: 1_000_000, count: 3 }, // 1MB x3
      { bytes: 5_000_000, count: 2 }, // 5MB x2
    ];

    const allMeasurements: BandwidthPoint[] = [];
    const loadedLatencies: number[] = [];
    let shouldStop = false;

    // Pre-generate random data for largest test size
    const maxBytes = Math.max(...testConfig.map((c) => c.bytes));
    const randomData = new Uint8Array(maxBytes);
    for (let i = 0; i < randomData.length; i++) {
      randomData[i] = Math.floor(Math.random() * 256);
    }

    for (const config of testConfig) {
      if (this.abortController?.signal.aborted || shouldStop) break;

      for (let i = 0; i < config.count; i++) {
        if (this.abortController?.signal.aborted || shouldStop) break;

        try {
          // Measure latency concurrently
          const latencyPromise = this.measureSingleLatency();

          // Use slice of pre-generated random data
          const data = randomData.slice(0, config.bytes);
          const blob = new Blob([data]);

          const start = performance.now();
          const response = await fetch(`https://speed.cloudflare.com/__up`, {
            method: 'POST',
            body: blob,
            signal: this.abortController?.signal,
          });
          const end = performance.now();
          const duration = end - start;

          if (!response.ok) {
            console.error(`Upload: HTTP error ${response.status}`);
            continue;
          }

          const bits = config.bytes * 8;
          const bps = bits / (duration / 1000);

          allMeasurements.push({ bytes: config.bytes, bps, duration });

          // Collect loaded latency
          const latency = await latencyPromise;
          if (latency > 0) loadedLatencies.push(latency);

          // Update results in real-time with current 90th percentile
          const currentSpeed = this.calculateBandwidth(allMeasurements);
          results.upload = currentSpeed;
          const latencyStats = this.calculateLatencyStats(loadedLatencies);
          results.uploadLatency = latencyStats.latency;
          results.uploadJitter = latencyStats.jitter;
          this.onProgress(results, 'upload');

          // Update chart data
          const chartPoints = allMeasurements.map((m) => m.bps);
          this.onChartUpdate('upload', chartPoints, currentSpeed);

          console.log(
            `Upload: ${(config.bytes / 1_000_000).toFixed(1)}MB #${i + 1} = ${(
              bps / 1_000_000
            ).toFixed(1)} Mbps (${duration.toFixed(0)}ms) | 90th pctl: ${(
              currentSpeed / 1_000_000
            ).toFixed(1)} Mbps`
          );

          // Stop testing larger sizes if this request exceeded threshold
          if (duration > this.MAX_DURATION_MS) {
            console.log(
              `Upload: Request took ${duration.toFixed(0)}ms > ${
                this.MAX_DURATION_MS
              }ms, stopping larger tests`
            );
            shouldStop = true;
            break;
          }
        } catch (error) {
          console.error('Upload test error:', error);
        }
      }
    }

    const speed = this.calculateBandwidth(allMeasurements);
    const { latency, jitter } = this.calculateLatencyStats(loadedLatencies);

    console.log(
      `Upload complete: ${(speed / 1_000_000).toFixed(1)} Mbps (${
        allMeasurements.length
      } measurements)`
    );
    return { speed, latency, jitter };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async measureSingleLatency(): Promise<number> {
    try {
      const start = performance.now();
      await fetch(`https://speed.cloudflare.com/__down?bytes=0&r=${Math.random()}`, {
        signal: this.abortController?.signal,
        cache: 'no-store',
      });
      return performance.now() - start;
    } catch {
      return 0;
    }
  }

  private calculateLatencyStats(latencies: number[]): { latency: number; jitter: number } {
    if (latencies.length === 0) {
      return { latency: 0, jitter: 0 };
    }

    // Calculate median latency (50th percentile)
    const sorted = [...latencies].sort((a, b) => a - b);
    const latency = this.percentile(sorted, this.LATENCY_PERCENTILE);

    // Calculate jitter (average deviation from median)
    const jitter = latencies.reduce((sum, p) => sum + Math.abs(p - latency), 0) / latencies.length;

    return { latency, jitter };
  }
}

// Animated number display component
const AnimatedNumber: FC<{
  value: number | null;
  format: (val: number | null) => string;
}> = ({ value, format }) => {
  const animatedValue = useAnimatedValue(value, 500);
  return <>{format(animatedValue)}</>;
};

const MetricDisplay: FC<{
  label: string;
  value: number | null;
  format: (val: number | null) => string;
  unit: string;
  subValues?: { download?: number | null; upload?: number | null };
  reserveSubValueSpace?: boolean;
}> = ({ label, value, format, unit, subValues, reserveSubValueSpace }) => {
  // Check if we have any non-null subValues to display
  const hasSubValues = subValues && (subValues.download !== null || subValues.upload !== null);
  // Reserve space if requested, even when subvalues aren't populated yet
  const showSubValueArea = hasSubValues || reserveSubValueSpace;

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{ fontSize: '12px', color: '#8b929a', marginBottom: '2px' }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <span style={{ fontSize: '28px', fontWeight: 'bold' }}>
          <AnimatedNumber value={value} format={format} />
        </span>
        <span style={{ fontSize: '14px', color: '#8b929a', marginLeft: '4px' }}>{unit}</span>
      </div>
      {showSubValueArea && (
        <div style={{ marginTop: '4px', fontSize: '12px', minHeight: '36px' }}>
          {subValues?.download !== null && subValues?.download !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2px' }}>
              <span style={{ color: '#f5a623', marginRight: '4px' }}>&#8595;</span>
              <span style={{ color: '#8b929a' }}>
                <AnimatedNumber value={subValues.download} format={format} /> {unit}
              </span>
            </div>
          )}
          {subValues?.upload !== null && subValues?.upload !== undefined && (
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ color: '#9b59b6', marginRight: '4px' }}>&#8593;</span>
              <span style={{ color: '#8b929a' }}>
                <AnimatedNumber value={subValues.upload} format={format} /> {unit}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// SVG-based speed chart component with smooth curves and animations
const SpeedChart: FC<{
  points: number[];
  percentile90: number;
  color: string; // Line/fill color
  height?: number;
  width?: number;
}> = ({ points, percentile90, color, height = 60, width = 140 }) => {
  // Need at least 2 points to draw a line
  if (points.length < 2) return null;

  // Track previous scale for animation
  const prevMaxRef = useRef<number>(0);
  const prevPointCountRef = useRef<number>(0);

  const padding = { top: 5, right: 5, bottom: 5, left: 0 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate the target data range
  const targetMax = Math.max(...points, percentile90) * 1.1; // 10% headroom

  // Animate the max value
  const animatedMax = useAnimatedValue(targetMax, 500) ?? targetMax;

  // Use animated max for rendering
  const dataMax = animatedMax;
  const minY = 0;

  // Map data points to SVG coordinates using animated scale
  const getX = (index: number, totalPoints: number) =>
    padding.left + (index / Math.max(1, totalPoints - 1)) * chartWidth;

  const getY = (value: number) => {
    if (dataMax === minY) return padding.top + chartHeight / 2;
    return padding.top + chartHeight - ((value - minY) / (dataMax - minY)) * chartHeight;
  };

  // Create smooth bezier curve through points (Catmull-Rom to Bezier)
  const createSmoothPath = (pts: number[]): string => {
    if (pts.length < 2) return '';

    const n = pts.length;

    if (n === 2) {
      return `M ${getX(0, n).toFixed(1)} ${getY(pts[0]).toFixed(1)} L ${getX(1, n).toFixed(
        1
      )} ${getY(pts[1]).toFixed(1)}`;
    }

    let path = `M ${getX(0, n).toFixed(1)} ${getY(pts[0]).toFixed(1)}`;

    for (let i = 0; i < n - 1; i++) {
      const p0 = { x: getX(Math.max(0, i - 1), n), y: getY(pts[Math.max(0, i - 1)]) };
      const p1 = { x: getX(i, n), y: getY(pts[i]) };
      const p2 = { x: getX(i + 1, n), y: getY(pts[i + 1]) };
      const p3 = { x: getX(Math.min(n - 1, i + 2), n), y: getY(pts[Math.min(n - 1, i + 2)]) };

      // Catmull-Rom to Bezier conversion
      const tension = 0.3;
      const cp1x = p1.x + (p2.x - p0.x) * tension;
      const cp1y = p1.y + (p2.y - p0.y) * tension;
      const cp2x = p2.x - (p3.x - p1.x) * tension;
      const cp2y = p2.y - (p3.y - p1.y) * tension;

      path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(
        1
      )}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }

    return path;
  };

  const smoothPath = createSmoothPath(points);
  const n = points.length;

  // Create area path (smooth line + close to bottom)
  const areaPath = `${smoothPath} L ${getX(n - 1, n).toFixed(1)} ${(
    padding.top + chartHeight
  ).toFixed(1)} L ${padding.left.toFixed(1)} ${(padding.top + chartHeight).toFixed(1)} Z`;

  // 90th percentile line Y position
  const percentileY = getY(percentile90);

  // Create gradient ID unique to this instance
  const gradientId = `gradient-${color.replace('#', '')}`;

  // Update refs for next render
  prevMaxRef.current = targetMax;
  prevPointCountRef.current = points.length;

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Area fill with gradient */}
      <path d={areaPath} fill={`url(#${gradientId})`} />

      {/* 90th percentile line */}
      <line
        x1={padding.left}
        y1={percentileY}
        x2={width - padding.right}
        y2={percentileY}
        stroke="#8b929a"
        strokeWidth="1"
        strokeDasharray="3,3"
        opacity="0.5"
      />

      {/* 90th percentile label */}
      <text x={padding.left + 2} y={percentileY - 3} fontSize="8" fill="#8b929a" opacity="0.7">
        90th
      </text>

      {/* Main smooth curve line */}
      <path
        d={smoothPath}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Data points (small circles) */}
      {points.map((point, i) => (
        <circle key={i} cx={getX(i, n)} cy={getY(point)} r="2" fill={color} />
      ))}
    </svg>
  );
};

interface ChartData {
  points: number[];
  percentile90: number;
}

function Content() {
  const [status, setStatus] = useState<TestStatus>('idle');
  const [phase, setPhase] = useState<TestPhase>('idle');
  const [results, setResults] = useState<SpeedTestResults>({
    download: null,
    upload: null,
    latency: null,
    jitter: null,
    downloadLatency: null,
    downloadJitter: null,
    uploadLatency: null,
    uploadJitter: null,
    measuredAt: null,
  });
  const [downloadChart, setDownloadChart] = useState<ChartData>({ points: [], percentile90: 0 });
  const [uploadChart, setUploadChart] = useState<ChartData>({ points: [], percentile90: 0 });
  const [serverLocation, setServerLocation] = useState<string | null>(null);

  const speedTestRef = useRef<SimpleSpeedTest | null>(null);
  const hasStartedRef = useRef(false);

  // Fetch server location on mount
  useEffect(() => {
    fetchCloudflareLocation().then(setServerLocation);
  }, []);

  const startTest = useCallback(() => {
    // Clean up any existing test
    if (speedTestRef.current) {
      speedTestRef.current.stop();
    }

    // Reset results
    setResults({
      download: null,
      upload: null,
      latency: null,
      jitter: null,
      downloadLatency: null,
      downloadJitter: null,
      uploadLatency: null,
      uploadJitter: null,
      measuredAt: null,
    });

    // Reset chart data
    setDownloadChart({ points: [], percentile90: 0 });
    setUploadChart({ points: [], percentile90: 0 });

    console.log('Speed Test: Creating new test engine...');

    const engine = new SimpleSpeedTest();

    engine.onProgress = (newResults, currentPhase) => {
      console.log('Speed Test: Progress update, phase:', currentPhase, newResults);
      setResults((prev) => ({ ...prev, ...newResults }));
      setPhase(currentPhase);
    };

    engine.onChartUpdate = (type, points, percentile90) => {
      if (type === 'download') {
        setDownloadChart({ points: [...points], percentile90 });
      } else {
        setUploadChart({ points: [...points], percentile90 });
      }
    };

    engine.onComplete = (finalResults) => {
      console.log('Speed Test: Complete', finalResults);
      setResults(finalResults);
      setStatus('finished');
      setPhase('done');
    };

    engine.onError = (error) => {
      console.error('Speed Test: Error:', error);
      setStatus('error');
    };

    speedTestRef.current = engine;
    setStatus('running');
    engine.start();
  }, []);

  const pauseTest = useCallback(() => {
    if (speedTestRef.current) {
      speedTestRef.current.pause();
      setStatus('paused');
    }
  }, []);

  const resumeTest = useCallback(() => {
    if (speedTestRef.current) {
      speedTestRef.current.resume();
      setStatus('running');
    }
  }, []);

  const restartTest = useCallback(() => {
    startTest();
  }, [startTest]);

  // Start test automatically on mount
  useEffect(() => {
    // Prevent double-execution in React Strict Mode
    if (hasStartedRef.current) {
      return;
    }
    hasStartedRef.current = true;

    console.log('Speed Test: Initial mount, starting test...');
    startTest();

    return () => {
      if (speedTestRef.current) {
        speedTestRef.current.stop();
      }
    };
  }, [startTest]);

  const isPaused = status === 'paused';
  const isRunning = status === 'running';
  const isFinished = status === 'finished';

  const getPhaseLabel = (): string => {
    switch (phase) {
      case 'latency':
        return 'Testing latency...';
      case 'download':
        return 'Testing download...';
      case 'upload':
        return 'Testing upload...';
      default:
        return '';
    }
  };

  // Scroll to top when component mounts
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollIntoView({ block: 'start' });
    }
  }, []);

  const showPauseButton = isRunning || isPaused;
  const showRetestButton = isFinished || status === 'error';

  return (
    <div ref={containerRef}>
      <PanelSection>
        {/* Server location */}
        {serverLocation && (
          <PanelSectionRow>
            <div style={{ width: '100%' }}>
              <div style={{ fontSize: '12px', color: '#8b929a', marginBottom: '2px' }}>
                Cloudflare Server Location
              </div>
              <div style={{ fontSize: '14px' }}>{serverLocation}</div>
            </div>
          </PanelSectionRow>
        )}

        {/* Two-column layout: Download/Chart/Latency on left, Upload/Chart/Jitter on right */}
        <PanelSectionRow>
          <div
            style={{
              width: '100%',
              display: 'flex',
              gap: '4px',
            }}>
            {/* Left column: Download, Chart, Latency */}
            <div style={{ flex: 1, textAlign: 'left' }}>
              <MetricDisplay
                label="Download"
                value={results.download}
                format={formatSpeed}
                unit="Mbps"
              />
              <div style={{ height: '60px' }}>
                <SpeedChart
                  points={downloadChart.points}
                  percentile90={downloadChart.percentile90}
                  color="#f5a623"
                />
              </div>
              <div style={{ marginTop: '12px' }}>
                <MetricDisplay
                  label="Latency"
                  value={results.latency}
                  format={formatLatency}
                  unit="ms"
                  subValues={{
                    download: results.downloadLatency,
                    upload: results.uploadLatency,
                  }}
                  reserveSubValueSpace
                />
              </div>
            </div>

            {/* Right column: Upload, Chart, Jitter */}
            <div style={{ flex: 1, textAlign: 'left' }}>
              <MetricDisplay
                label="Upload"
                value={results.upload}
                format={formatSpeed}
                unit="Mbps"
              />
              <div style={{ height: '60px' }}>
                <SpeedChart
                  points={uploadChart.points}
                  percentile90={uploadChart.percentile90}
                  color="#9b59b6"
                />
              </div>
              <div style={{ marginTop: '12px' }}>
                <MetricDisplay
                  label="Jitter"
                  value={results.jitter}
                  format={formatLatency}
                  unit="ms"
                  subValues={{
                    download: results.downloadJitter,
                    upload: results.uploadJitter,
                  }}
                  reserveSubValueSpace
                />
              </div>
            </div>
          </div>
        </PanelSectionRow>

        {/* Pause/Resume button - only show while testing */}
        {showPauseButton && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={isPaused ? resumeTest : pauseTest}>
              {isPaused ? 'Resume' : 'Pause'}
            </ButtonItem>
          </PanelSectionRow>
        )}

        {/* Retest button - only show when finished or error */}
        {showRetestButton && (
          <PanelSectionRow>
            <ButtonItem layout="below" onClick={restartTest}>
              Retest
            </ButtonItem>
          </PanelSectionRow>
        )}

        {/* Measured At timestamp */}
        {isFinished && results.measuredAt && (
          <PanelSectionRow>
            <div
              style={{
                width: '100%',
                textAlign: 'right',
                fontSize: '11px',
                color: '#8b929a',
              }}>
              Measured at {formatTime(results.measuredAt)}
            </div>
          </PanelSectionRow>
        )}

        {/* Status indicator */}
        {isRunning && (
          <PanelSectionRow>
            <div
              style={{
                width: '100%',
                textAlign: 'center',
                fontSize: '12px',
                color: '#1a9fff',
                marginTop: '4px',
              }}>
              {getPhaseLabel()}
            </div>
          </PanelSectionRow>
        )}

        {/* Error indicator */}
        {status === 'error' && (
          <PanelSectionRow>
            <div
              style={{
                width: '100%',
                textAlign: 'center',
                fontSize: '12px',
                color: '#ff4444',
                marginTop: '4px',
              }}>
              Test failed - check network connection
            </div>
          </PanelSectionRow>
        )}
      </PanelSection>
    </div>
  );
}

export default definePlugin(() => {
  console.log('Speed Test plugin initializing');

  return {
    name: 'Speed Test',
    titleView: <div className={staticClasses.Title}>Speed Test</div>,
    content: <Content />,
    icon: <FaNetworkWired />,
    onDismount() {
      console.log('Speed Test plugin unloading');
    },
  };
});
