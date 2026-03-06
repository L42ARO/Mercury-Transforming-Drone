// src/api/driveSocket.ts
import { io, Socket } from "socket.io-client";

export type DriveCmd =
  | { type: "mix"; left: number; right: number }
  | { type: "forward" | "backward"; speed: number }
  | { type: "left" | "right"; speed: number }
  | { type: "stop" };

export class DriveSocket {
  private socket: Socket | null = null;
  private raf: number | null = null;
  private latest: DriveCmd | null = null;
  private lastSentKey = "";

  constructor(private baseUrl: string) {}

  connect() {
    if (this.socket) return;
    this.socket = io(this.baseUrl, {
      transports: ["websocket"], // skip long-polling for lowest latency
      forceNew: true,
      path: "/socket.io",        // default; keep if server uses the default
      withCredentials: false,
    });
    // optional: log
    // this.socket.on("connect", () => console.log("WS connected"));
    // this.socket.on("disconnect", () => console.log("WS disconnected"));
  }

  isReady(): boolean {
    return !!this.socket && this.socket.connected;
  }

  /** Queue a command; it will be coalesced and sent at ~60Hz */
  send(cmd: DriveCmd) {
    this.latest = cmd;
    if (this.raf == null) this.loop();
  }

  private loop = () => {
    if (!this.latest) { this.raf = null; return; }
    const s = this.socket;
    if (s && s.connected) {
      const key = JSON.stringify(this.latest);
      if (key !== this.lastSentKey) {
        // Translate DriveCmd -> server payload (matches the Flask handlers you added)
        const c = this.latest;
        if (c.type === "mix") {
          s.emit("drive", { cmd: "mix", left: c.left, right: c.right });
        } else if (c.type === "forward") {
          s.emit("drive", { cmd: "forward", speed: c.speed });
        } else if (c.type === "backward") {
          s.emit("drive", { cmd: "backward", speed: c.speed });
        } else if (c.type === "left") {
          s.emit("drive", { cmd: "left", speed: c.speed });
        } else if (c.type === "right") {
          s.emit("drive", { cmd: "right", speed: c.speed });
        } else if (c.type === "stop") {
          s.emit("drive", { cmd: "stop" });
        }
        this.lastSentKey = key;
      }
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  stopNow() {
    // always push an immediate stop through WS if available
    const s = this.socket;
    if (s && s.connected) {
      s.emit("drive", { cmd: "stop" });
    }
    this.latest = { type: "stop" };
    this.lastSentKey = ""; // allow next non-stop to go through
  }

  destroy() {
    if (this.raf != null) cancelAnimationFrame(this.raf);
    this.raf = null;
    this.latest = null;
    try { this.socket?.disconnect(); } catch {}
    this.socket = null;
  }
}
