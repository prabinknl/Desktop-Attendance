import type { IDeviceAdapter, DeviceConnectionConfig } from './IDeviceAdapter.js';
import { HikvisionService } from './HikvisionService.js';
import type { DeviceBrand } from '../../types/index.js';

/** Factory to create the correct device adapter by brand. */
export function createDeviceAdapter(
  brand: DeviceBrand,
  config: DeviceConnectionConfig,
): IDeviceAdapter {
  switch (brand) {
    case 'hikvision':
      return new HikvisionService(config);
    case 'zkteco':
    case 'essl':
    case 'suprema':
    case 'other':
      throw new Error(
        `${brand} integration is not implemented yet. Select Hikvision and use ISAPI (HTTP Digest).`,
      );
    default:
      throw new Error(`Unsupported device brand: ${brand}`);
  }
}

/** Default ports per brand. */
export function getDefaultPort(brand: DeviceBrand): number {
  switch (brand) {
    case 'hikvision':
      return 80;
    case 'zkteco':
    case 'essl':
      return 4370;
    case 'suprema':
      return 1470;
    default:
      return 80;
  }
}
