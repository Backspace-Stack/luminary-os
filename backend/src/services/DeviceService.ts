// ============================================================
// DeviceService — Manages connected device state.
//
// Delegates to DeviceManager, the registry of live IDevice
// instances. No device adapters register themselves yet, so
// the list is honestly empty — there is no mock data.
// ============================================================

import { Logger } from '../core/logger/Logger';
import { deviceManager } from '../devices/DeviceManager';
import type { DeviceInfo } from '../core/types/IDevice';

const logger = Logger.scope('DeviceService');

export class DeviceService {

  listDevices(filters?: { type?: string; status?: string }): DeviceInfo[] {
    let result = deviceManager.getAllInfo();
    if (filters?.type)   result = result.filter((d) => d.type === filters.type);
    if (filters?.status) result = result.filter((d) => d.status === filters.status);
    return result;
  }

  getDevice(id: string): DeviceInfo | null {
    return deviceManager.findById(id)?.getInfo() ?? null;
  }

  async connect(id: string): Promise<DeviceInfo> {
    const device = deviceManager.findById(id);
    if (!device) throw new Error(`Device "${id}" is not registered`);
    await device.connect();
    logger.info(`Device connected: ${id}`);
    return device.getInfo();
  }

  async disconnect(id: string): Promise<DeviceInfo> {
    const device = deviceManager.findById(id);
    if (!device) throw new Error(`Device "${id}" is not registered`);
    await device.disconnect();
    logger.info(`Device disconnected: ${id}`);
    return device.getInfo();
  }

  stats(): { total: number; online: number; streaming: number; offline: number } {
    const devices = deviceManager.getAllInfo();
    return {
      total:     devices.length,
      online:    devices.filter((d) => d.status !== 'offline').length,
      streaming: devices.filter((d) => d.status === 'streaming').length,
      offline:   devices.filter((d) => d.status === 'offline').length,
    };
  }
}

export const deviceService = new DeviceService();
