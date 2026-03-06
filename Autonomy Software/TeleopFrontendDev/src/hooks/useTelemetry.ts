// src/hooks/useTelemetry.ts
import { useEffect, useRef, useState } from "react";
import { Telemetry, TelemetrySocket } from "../api/telemetrySocket";

export function useTelemetry(baseUrl?: string | null) {
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const ref = useRef<TelemetrySocket | null>(null);

  useEffect(() => {
    // teardown old socket if baseUrl changes or goes away
    ref.current?.destroy();
    ref.current = null;

    if (!baseUrl) return;

    const sock = new TelemetrySocket(baseUrl);
    ref.current = sock;
    sock.connect(setTelemetry);

    return () => {
      sock.destroy();
      ref.current = null;
    };
  }, [baseUrl]);

  return telemetry;
}
