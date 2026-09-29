"use client";

import { useEffect, useState } from "react";
import { tenantsApi } from "./api";
import { subdomainFromHost } from "./domain";

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
