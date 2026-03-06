// Tiny HTTP client for the Raspberry Pi Flask server
export type Health = { ok: boolean; connected: boolean; port: string; baud: number; last_ok: number };
export type OkResp = { ok: boolean };
export type ConnectResp = { ok: boolean; connected: boolean; port: string };
export type StatusResp = { ok: boolean; connected: boolean };

function withTimeout<T>(p: Promise<T>, ms = 3000): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return new Promise<T>((resolve, reject) => {
    p.then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}

function normalizeBase(hostOrIp: string) {
  // Allow full URLs like https://foo:8080
  if (/^https?:\/\//i.test(hostOrIp)) return hostOrIp.replace(/\/+$/, '');
  // Otherwise, pick scheme based on current page
  const scheme = (typeof window !== 'undefined' && window.location.protocol === 'https:') ? 'https' : 'http';
  return `${scheme}://${hostOrIp}`;
}

export function createRobotClient(hostOrIp: string) {
  const base = normalizeBase(hostOrIp);

  async function j<T>(path: string, init?: RequestInit, timeoutMs = 3000): Promise<T> {
    const res = await withTimeout(fetch(base + path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    }), timeoutMs);
    if (!res.ok) {
      const text = await (res as Response).text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${text}`);
    }
    try { return (await (res as Response).json()) as T; }
    catch { return {} as T; }
  }

  return {
    baseUrl: base,

    // --- existing methods (unchanged) ---
    health: () => j<Health>('/health', { method: 'GET' }),
    connect: (port?: string) => j<ConnectResp>('/connect', { method: 'POST', body: JSON.stringify(port ? { port } : {}) }),
    status: () => j<StatusResp>('/status', { method: 'GET' }),
    setMode: (mode: 'car' | 'drone') => j<OkResp>('/mode', { method: 'POST', body: JSON.stringify({ mode }) }),
    drive: (cmd: 'forward' | 'backward' | 'left' | 'right' | 'mix' | 'stop', opts?: { speed?: number; left?: number; right?: number }) =>
      j<OkResp>('/drive', { method: 'POST', body: JSON.stringify({ cmd, ...(opts || {}) }) }),
    stop: () => j<OkResp>('/stop', { method: 'POST' }),

    // --- camera (existing) ---
    startCamera: () => j('/camera/start', { method: 'POST' }),
    stopCamera: () => j('/camera/stop', { method: 'POST' }),
    cameraStatus: () => j('/camera/status', { method: 'GET' }),
    cameraFeedUrl: () => `${base}/camera/feed`,
    cameraFrameUrl: () => `${base}/camera/frame`,
    recordStart: () => j('/camera/record/start', { method: 'POST' }),
    recordStop: () => j('/camera/record/stop', { method: 'POST' }),
    recordStatus: () => j('/camera/record/status', { method: 'GET' }),

    // --- Camera (ToF) ---
    startTofCamera: () => j('/tof_camera/start', { method: 'POST' }),
    stopTofCamera: () => j('/tof_camera/stop', { method: 'POST' }),
    tofCameraStatus: () => j('/tof_camera/status', { method: 'GET' }),


    // The confidence parameter is now exposed in the API client method
    tofCameraFeedUrl: (confidence: number = 30) => `${base}/tof_camera/feed?confidence=${confidence}`,
    tofCameraFrameUrl: (confidence: number = 30) => `${base}/tof_camera/frame?confidence=${confidence}`,
    tofRecordStart: () => j('/tof_camera/record/start', { method: 'POST' }),
    tofRecordStop: () => j('/tof_camera/record/stop', { method: 'POST' }),
    tofRecordStatus: () => j('/tof_camera/record/status', { method: 'GET' }),

    // --- NEW: Thermal Camera ---
    startThermal: () => j('/thermal/start', { method: 'POST' }),
    stopThermal: () => j('/thermal/stop', { method: 'POST' }),
    thermalStatus: () => j('/thermal/status', { method: 'GET' }),
    thermalFeedUrl: () => `${base}/thermal/feed`,
    thermalFrameUrl: () => `${base}/thermal/frame`,
    thermalRecordStart: () => j('/thermal/record/start', { method: 'POST' }),
    thermalRecordStop: () => j('/thermal/record/stop', { method: 'POST' }),
    thermalRecordStatus: () => j('/thermal/record/status', { method: 'GET' }),

    // --- lock/unlock ---
    lock: (hold_ms?: number) => j<{ ok: boolean; hold_ms: number | null }>(
      '/lock', { method: 'POST', body: JSON.stringify(hold_ms != null ? { hold_ms } : {}) }
    ),
    unlock: () => j<{ ok: boolean }>('/unlock', { method: 'POST' }),

    // --- MAVLink actions ---
    arm: () => j<OkResp>('/arm', { method: 'POST' }),
    disarm: () => j<OkResp>('/disarm', { method: 'POST' }),
    takeoff: (altitude?: number) =>
      j<OkResp>('/takeoff', { method: 'POST', body: JSON.stringify(typeof altitude === 'number' ? { altitude } : {}) }),
    land: () => j<OkResp>('/land', { method: 'POST' }),

    // --- Autopilot flight mode ---
    setFlightMode: (mode: string) =>
      j<OkResp>('/flight_mode', { method: 'POST', body: JSON.stringify({ mode }) }),

    // --- Mission ---
    missionDownload: () => j<{ ok: boolean; count: number; items: any[] }>('/mission/download', { method: 'GET' }),
    missionUpload: (waypoints: any[]) => j<OkResp>('/mission/upload', { method: 'POST', body: JSON.stringify({ waypoints }) }),
    missionClear: () => j<OkResp>('/mission/clear', { method: 'POST' }),
    missionAuto: () => j<OkResp>('/mission/auto', { method: 'POST' }),
    missionStart: () => j<OkResp>('/mission/start', { method: 'POST' }),

    // --- NEW: FCU maintenance/calibration ---
    fcuReboot: () => j<OkResp>('/fcu/reboot', { method: 'POST' }),
    preflightLevel: () => j<OkResp>('/fcu/preflight/level', { method: 'POST' }),
    preflightGyro: () => j<OkResp>('/fcu/preflight/gyro', { method: 'POST' }),
    preflightAccel: () => j<OkResp>('/fcu/preflight/accel', { method: 'POST' }),
  };
}
