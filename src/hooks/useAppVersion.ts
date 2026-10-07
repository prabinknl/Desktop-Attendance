import { useEffect, useState } from 'react';
import { FALLBACK_APP_VERSION, resolveAppVersion } from '../lib/appVersion';

/** Installed app version (Electron `app.getVersion()`), falling back to the build-time version. */
export function useAppVersion(): string {
  const [version, setVersion] = useState(FALLBACK_APP_VERSION);
  useEffect(() => {
    let cancelled = false;
    void resolveAppVersion().then((v) => {
      if (!cancelled && v) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}
