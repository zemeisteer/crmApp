import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MockTelephonyProvider } from './mock.provider';
import type { TelephonyProvider, TelephonyProviderName } from './telephony-provider.interface';
import { ZadarmaProvider } from './zadarma.provider';

/** The provider adapters, one instance each. A new provider is one more entry here. */
@Injectable()
export class TelephonyProviders {
  private readonly byName: Record<TelephonyProviderName, TelephonyProvider>;

  constructor(config: ConfigService) {
    this.byName = {
      // ZADARMA_API_URL: https://api-sandbox.zadarma.com for Zadarma's sandbox.
      ZADARMA: new ZadarmaProvider({ baseUrl: config.get<string>('ZADARMA_API_URL') }),
      MOCK: new MockTelephonyProvider(),
    };
  }

  get(name: TelephonyProviderName): TelephonyProvider {
    return this.byName[name];
  }

  /** The mock, for the local simulator and tests. */
  get mock(): MockTelephonyProvider {
    return this.byName.MOCK as MockTelephonyProvider;
  }
}

export const TELEPHONY_PROVIDER_NAMES = ['ZADARMA', 'MOCK'] as const;
