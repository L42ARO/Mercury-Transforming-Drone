// src/api/telemetrySocket.ts
import { io, Socket } from "socket.io-client";

export type Telemetry = {
  connected: boolean;
  mode: string | null;
  vehicle_type: number | null;
  attitude: { roll_deg: number; pitch_deg: number; yaw_deg: number };
  position: { lat: number | null; lon: number | null; alt_m: number | null; rel_alt_m: number | null };
  vel: { vx_ms: number; vy_ms: number; vz_ms: number; groundspeed_ms: number };
  heading_deg: number | null;
  gps_sats: number | null;
  battery_pct: number | null;
  timestamp: number;
};

export class TelemetrySocket {
  private socket: Socket | null = null;
  private onUpdate?: (t: Telemetry) => void;

  constructor(private baseUrl: string) {}

  connect(onUpdate: (t: Telemetry) => void) {
    this.onUpdate = onUpdate;
    if (this.socket?.connected) return;

    this.socket = io(this.baseUrl + "/telemetry", {
      path: "/socket.io",
      withCredentials: false,
      transports: ["websocket"], // eventlet supports ws now
      forceNew: true,
    });

    this.socket.on("telemetry", (data: Telemetry) => {
      this.onUpdate?.(data);
    });

    this.socket.on("disconnect", () => {
      // optional: you can set a flag or retry here
    });
  }

  destroy() {
    try { this.socket?.removeAllListeners(); } catch {}
    try { this.socket?.disconnect(); } catch {}
    this.socket = null;
    this.onUpdate = undefined;
  }
}
