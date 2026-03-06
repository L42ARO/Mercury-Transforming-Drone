// src/api/cameraSocket.ts
import { io, Socket } from "socket.io-client";

type FrameHandler = (buf: ArrayBuffer) => void;

export class CameraSocket {
  private socket: Socket | null = null;
  private onFrameCb: FrameHandler | null = null;

  constructor(private baseUrl: string) {}

  onFrame(cb: FrameHandler) {
    this.onFrameCb = cb;
  }

  connect() {
    if (this.socket) return;

    // Connect to the /camera namespace
    this.socket = io(this.baseUrl + "/camera", {
      transports: ["websocket"], // skip long-polling
      forceNew: true,
      path: "/socket.io",
      withCredentials: false,
    });

    // Make sure incoming binary frames arrive as ArrayBuffer
    // (socket.io-client >=4 defaults to blob in browser; ArrayBuffer is cheaper to re-wrap)
    (this.socket.io as any).engine.binaryType = "arraybuffer";

    this.socket.on("connect", () => {
      try {
        this.socket?.emit("subscribe");
      } catch {}
    });

    this.socket.on("frame", (data: ArrayBuffer) => {
      // server emits raw JPEG bytes (binary=True)
      if (this.onFrameCb) this.onFrameCb(data);
    });

    // optional logs
    // this.socket.on("connect_error", (e) => console.debug("[cam ws] connect_error", e?.message));
    // this.socket.on("disconnect", (r) => console.debug("[cam ws] disconnected:", r));
  }

  disconnect() {
    try {
      this.socket?.emit("unsubscribe");
    } catch {}
    try {
      this.socket?.disconnect();
    } catch {}
    this.socket = null;
    this.onFrameCb = null;
  }
}
