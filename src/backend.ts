import { callable } from '@decky/api';
import {
  BandwidthMeasurement,
  HistoryRecord,
  LatencyMeasurement,
  NetworkProtocol,
  Preferences,
  ServerId,
} from './model';

export const getPreferences = callable<[], Preferences>('get_preferences');

export const savePreferences = callable<[preferences: Preferences], Preferences>(
  'save_preferences'
);

export const measureLatency = callable<
  [serverId: ServerId, protocol: NetworkProtocol],
  LatencyMeasurement
>('measure_latency');

export const measureDownloadSample = callable<
  [serverId: ServerId, protocol: NetworkProtocol, sizeMegabytes: number],
  BandwidthMeasurement
>('measure_download_sample');

export const warmUpDownload = callable<
  [serverId: ServerId, protocol: NetworkProtocol],
  void
>('warm_up_download');

export const measureUploadSample = callable<
  [serverId: ServerId, protocol: NetworkProtocol, sizeMegabytes: number],
  BandwidthMeasurement
>('measure_upload_sample');

export const getHistory = callable<[], HistoryRecord[]>('get_history');

export const saveHistory = callable<[record: HistoryRecord], HistoryRecord>('save_history');
