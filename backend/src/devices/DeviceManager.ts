// ============================================================
// DeviceManager — Registry and lifecycle manager for IDevice instances.
//
// Holds live IDevice instances only. No adapters register yet,
// so the registry is empty until real devices connect.
//
// Future implementation:
//   - Each connected device is represented by a concrete IDevice
//   - DeviceManager manages connect / disconnect / ping cycles
//   - Plugins (WindowsPlugin, BrowserPlugin) resolve their
//     underlying device through this manager
// ============================================================

import type { IDevice, DeviceInfo } from '../core/types/IDevice';
import { eventBus, EVENTS } from '../core/events/EventBus';
import { Logger } from '../core/logger/Logger';

const logger = Logger.scope('DeviceManager');

export class DeviceManager {
  private static instance: DeviceManager;
  private devices = new Map<string, IDevice>();

  private constructor() {}

  static getInstance(): DeviceManager {
    if (!DeviceManager.instance) DeviceManager.instance = new DeviceManager();
    return DeviceManager.instance;
  }

  /**
   * Register a live IDevice. Called when a device authenticates
   * with the Luminary OS backend (e.g. via WebSocket handshake
   * for ESP32, or browser extension connection for Chrome).
   */
  register(device: IDevice): void {
    this.devices.set(device.id, device);
    logger.info(`Device registered: ${device.id} (${device.type})`);
    eventBus.emit(EVENTS.DEVICE_CONNECTED, { deviceId: device.id }, 'DeviceManager');
  }

  unregister(id: string): void {
    const device = this.devices.get(id);
    if (device) {
      void device.disconnect();
      this.devices.delete(id);
      logger.info(`Device unregistered: ${id}`);
      eventBus.emit(EVENTS.DEVICE_DISCONNECTED, { deviceId: id }, 'DeviceManager');
    }
  }

  findById(id: string): IDevice | undefined {
    return this.devices.get(id);
  }

  findByType(type: string): IDevice[] {
    return Array.from(this.devices.values()).filter(d => d.type === type);
  }

  getAll(): IDevice[] {
    return Array.from(this.devices.values());
  }

  getAllInfo(): DeviceInfo[] {
    return this.getAll().map(d => d.getInfo());
  }

  /**
   * Ping all registered devices; unregister those that time out.
   * Called by a periodic health-check timer.
   */
  async pingAll(): Promise<void> {
    for (const [id, device] of this.devices) {
      try {
        const alive = await device.ping();
        if (!alive) {
          logger.warn(`Device ${id} did not respond to ping — marking offline`);
          this.unregister(id);
        }
      } catch {
        this.unregister(id);
      }
    }
  }

  count(): number {
    return this.devices.size;
  }
}

export const deviceManager = DeviceManager.getInstance();
