// ============================================================
// IDevice — Core contract for connected physical/virtual devices.
//
// Devices are distinct from Plugins: a Device represents a
// connected endpoint (ESP32, camera, desktop OS), while a
// Plugin provides a capability abstraction (FilePlugin) that
// may use one or more Device connections underneath.
// ============================================================

export type DeviceType = 'browser' | 'windows' | 'esp32' | 'camera' | 'linux' | 'macos';
export type DeviceStatus = 'connected' | 'streaming' | 'offline' | 'pairing';

export interface DeviceCapability {
  name: string;
  description: string;
}

export interface DeviceInfo {
  id: string;
  name: string;
  type: DeviceType;
  status: DeviceStatus;
  ipAddress: string;
  lastSeenAt: string;
  version: string;
  capabilities: string[];
}

export interface DeviceCommand {
  command: string;
  args?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface DeviceCommandResult {
  success: boolean;
  data?: unknown;
  error?: string;
  durationMs?: number;
}

/**
 * IDevice — Every connected device adapter must implement this.
 *
 * The DeviceManager holds a registry of IDevice instances and
 * exposes them to Plugins that need physical/remote access.
 */
export interface IDevice {
  readonly id: string;
  readonly type: DeviceType;

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  ping(): Promise<boolean>;
  send(command: DeviceCommand): Promise<DeviceCommandResult>;
  getInfo(): DeviceInfo;
  getStatus(): DeviceStatus;
}
