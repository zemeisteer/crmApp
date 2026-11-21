"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { tenantsApi } from "./api";
import { centerAddress, centerDomainSuffix, subdomainFromHost } from "./domain";

export interface HostCenter {
  subdomain: string;
  name: string | null;
}

// The center whose subdomain this page is opened on (ilm.<ROOT_DOMAIN>/portal),
// or null on the main site. The name loads after the first render.
export function useCenterFromHost(): HostCenter | null {
  const [center, setCenter] = useState<HostCenter | null>(null);
  useEffect(() => {
    const sub = subdomainFromHost(window.location.host);
    if (!sub) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reads window, so only after mount
    setCenter({ subdomain: sub, name: null });
    tenantsApi.bySubdomain(sub)
      .then((t) => { if (alive) setCenter({ subdomain: sub, name: t.name }); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  return center;
}

const noSubscribe = () => () => undefined;

/** The host this page is open on (with its port), or null while rendering on the server. */
export function useBrowserHost(): string | null {
  return useSyncExternalStore(noSubscribe, () => window.location.host, () => null);
}

/**
 * The address a center actually runs on, from this browser: `<sub>.localhost:<port>`
 * on a dev machine, `<sub>.<ROOT_DOMAIN>` everywhere else (lib/domain.ts centerAddress).
 */
export function useCenterAddress() {
  const here = useBrowserHost();
  return {
    host: (subdomain: string) => centerAddress(subdomain, here).host,
    url: (subdomain: string) => centerAddress(subdomain, here).url,
    suffix: centerDomainSuffix(here),
  };
}
