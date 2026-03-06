// src/hooks/useRobot.ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRobotClient } from '../api/robot';
import { DriveSocket } from '../api/driveSocket';

export function useRobot(ip: string | null) {
  const client = useMemo(() => (ip ? createRobotClient(ip) : null), [ip]);

  // === WS drive socket lifecycle ===
  const driveSockRef = useRef<DriveSocket | null>(null);
  useEffect(() => {
    driveSockRef.current?.destroy();
    driveSockRef.current = null;
    if (!client?.baseUrl) return;

    const ds = new DriveSocket(client.baseUrl);
    ds.connect();
    driveSockRef.current = ds;

    const onUnload = () => { try { ds.stopNow(); } catch { } };
    window.addEventListener('beforeunload', onUnload);
    return () => { window.removeEventListener('beforeunload', onUnload); ds.destroy(); };
  }, [client?.baseUrl]);

  const [connected, setConnected] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll /health
  useEffect(() => {
    if (!client) return;
    let cancel = false;
    const tick = async () => {
      try {
        setPinging(true);
        const h = await client.health();
        if (!cancel) { setConnected(!!h.connected); setError(null); }
      } catch (e: any) {
        if (!cancel) { setConnected(false); setError(e?.message || 'Health error'); }
      } finally {
        if (!cancel) setPinging(false);
      }
    };
    tick();
    const id = setInterval(tick, 30000);
    return () => { cancel = true; clearInterval(id); };
  }, [client]);

  // WS-or-HTTP drive helpers
  function driveViaWsOrHttp(cmd: 'forward' | 'backward' | 'left' | 'right' | 'mix' | 'stop', opts?: any) {
    const ds = driveSockRef.current;
    if (ds && ds.isReady()) {
      if (cmd === 'mix') { ds.send({ type: 'mix', left: Number(opts?.left ?? 0), right: Number(opts?.right ?? 0) }); return Promise.resolve({ ok: true }); }
      if (cmd === 'stop') { ds.stopNow(); return Promise.resolve({ ok: true }); }
      ds.send({ type: cmd, speed: Number(opts?.speed ?? 50) });
      return Promise.resolve({ ok: true });
    }
    return client!.drive(cmd as any, opts);
  }
  function stopViaWsOrHttp() {
    const ds = driveSockRef.current;
    if (ds && ds.isReady()) { ds.stopNow(); return Promise.resolve({ ok: true }); }
    return client!.stop();
  }

  return {
    client,
    connected,
    pinging,
    error,

    async connect(port?: string) {
      if (!client) return { ok: false, connected: false, port: '' };
      try {
        const r = await client.connect(port);
        setConnected(!!r.connected);
        setError(null);
        return r;
      } catch (e: any) {
        setError(e?.message || 'Connect failed');
        setConnected(false);
        return { ok: false, connected: false, port: '' };
      }
    },

    async setMode(mode: 'car' | 'drone') {
      if (!client) return { ok: false };
      try { return await client.setMode(mode); }
      catch (e: any) { setError(e?.message || 'Mode failed'); return { ok: false }; }
    },

    async drive(cmd: 'forward' | 'backward' | 'left' | 'right' | 'mix' | 'stop', opts?: any) {
      if (!client) return { ok: false };
      try { return await driveViaWsOrHttp(cmd, opts); }
      catch (e: any) { setError(e?.message || 'Drive failed'); return { ok: false }; }
    },

    async stop() {
      if (!client) return { ok: false };
      try { return await stopViaWsOrHttp(); }
      catch (e: any) { setError(e?.message || 'Stop failed'); return { ok: false }; }
    },

    async lock(hold_ms?: number) {
      if (!client) return { ok: false, hold_ms: null as number | null };
      try { return await client.lock(hold_ms); }
      catch (e: any) { setError(e?.message || 'Lock failed'); return { ok: false, hold_ms: null }; }
    },

    async unlock() {
      if (!client) return { ok: false };
      try { return await client.unlock(); }
      catch (e: any) { setError(e?.message || 'Unlock failed'); return { ok: false }; }
    },

    async startCamera() { if (!client) return { ok: false }; try { return await client.startCamera(); } catch (e: any) { setError(e?.message || 'Camera start failed'); return { ok: false }; } },
    async stopCamera() { if (!client) return { ok: false }; try { return await client.stopCamera(); } catch (e: any) { setError(e?.message || 'Camera stop failed'); return { ok: false }; } },
    async cameraStatus() { if (!client) return { ok: false }; try { return await client.cameraStatus(); } catch (e: any) { setError(e?.message || 'Camera status failed'); return { ok: false }; } },
    async recordStart() { if (!client) return { ok: false }; try { return await client.recordStart(); } catch (e: any) { setError(e?.message || 'Record start failed'); return { ok: false }; } },
    async recordStop() { if (!client) return { ok: false }; try { return await client.recordStop(); } catch (e: any) { setError(e?.message || 'Record stop failed'); return { ok: false }; } },
    async recordStatus() { if (!client) return { ok: false }; try { return await client.recordStatus(); } catch (e: any) { setError(e?.message || 'Record status failed'); return { ok: false }; } },

    // --- Camera (ToF) ---
    async startTofCamera() { if (!client) return { ok: false }; try { return await client.startTofCamera(); } catch (e: any) { setError(e?.message || 'ToF start failed'); return { ok: false }; } },
    async stopTofCamera() { if (!client) return { ok: false }; try { return await client.stopTofCamera(); } catch (e: any) { setError(e?.message || 'ToF stop failed'); return { ok: false }; } },
    async tofCameraStatus() { if (!client) return { ok: false }; try { return await client.tofCameraStatus(); } catch (e: any) { setError(e?.message || 'ToF status failed'); return { ok: false }; } },
    async tofRecordStart() { if (!client) return { ok: false }; try { return await client.tofRecordStart(); } catch (e: any) { setError(e?.message || 'ToF record start failed'); return { ok: false }; } },
    async tofRecordStop() { if (!client) return { ok: false }; try { return await client.tofRecordStop(); } catch (e: any) { setError(e?.message || 'ToF record stop failed'); return { ok: false }; } },
    async tofRecordStatus() { if (!client) return { ok: false }; try { return await client.tofRecordStatus(); } catch (e: any) { setError(e?.message || 'ToF record status failed'); return { ok: false }; } },

// --- NEW: Thermal Camera Wrappers ---
    async startThermal() { if (!client) return { ok: false }; try { return await client.startThermal(); } catch (e: any) { setError(e?.message || 'Thermal start failed'); return { ok: false }; } },
    async stopThermal() { if (!client) return { ok: false }; try { return await client.stopThermal(); } catch (e: any) { setError(e?.message || 'Thermal stop failed'); return { ok: false }; } },
    async thermalStatus() { if (!client) return { ok: false }; try { return await client.thermalStatus(); } catch (e: any) { setError(e?.message || 'Thermal status failed'); return { ok: false }; } },
    async thermalRecordStart() { if (!client) return { ok: false }; try { return await client.thermalRecordStart(); } catch (e: any) { setError(e?.message || 'Thermal record start failed'); return { ok: false }; } },
    async thermalRecordStop() { if (!client) return { ok: false }; try { return await client.thermalRecordStop(); } catch (e: any) { setError(e?.message || 'Thermal record stop failed'); return { ok: false }; } },
    async thermalRecordStatus() { if (!client) return { ok: false }; try { return await client.thermalRecordStatus(); } catch (e: any) { setError(e?.message || 'Thermal record status failed'); return { ok: false }; } },

    // --- MAVLink actions ---
    async arm() { if (!client) return { ok: false }; try { return await client.arm(); } catch (e: any) { setError(e?.message || 'Arm failed'); return { ok: false }; } },
    async disarm() { if (!client) return { ok: false }; try { return await client.disarm(); } catch (e: any) { setError(e?.message || 'Disarm failed'); return { ok: false }; } },
    // src/hooks/useRobot.ts (in the returned object)
    async takeoff(altitude?: number) {
      if (!client) return { ok: false };
      try { return await client.takeoff(altitude); }
      catch (e: any) { setError(e?.message || 'Takeoff failed'); return { ok: false }; }
    },

    async land() { if (!client) return { ok: false }; try { return await client.land(); } catch (e: any) { setError(e?.message || 'Land failed'); return { ok: false }; } },

    // --- Autopilot flight mode ---
    async setAutopilotFlightMode(mode: string) {
      console.log('[useRobot] setAutopilotFlightMode called with:', mode);
      if (!client) return { ok: false };
      try {
        const res = await client.setFlightMode(mode);
        console.log('[useRobot] backend response:', res);
        return res;
      } catch (e: any) {
        setError(e?.message || 'Set flight mode failed');
        return { ok: false };
      }
    },


    // --- NEW: Mission helpers (no direct API calls in components) ---
    async missionDownload() {
      if (!client) return { ok: false, count: 0, items: [] as any[] };
      try { return await client.missionDownload(); }
      catch (e: any) { setError(e?.message || 'Mission download failed'); return { ok: false, count: 0, items: [] }; }
    },
    async missionUpload(waypoints: any[]) {
      if (!client) return { ok: false };
      try { return await client.missionUpload(waypoints); }
      catch (e: any) { setError(e?.message || 'Mission upload failed'); return { ok: false }; }
    },
    async missionClear() {
      if (!client) return { ok: false };
      try { return await client.missionClear(); }
      catch (e: any) { setError(e?.message || 'Mission clear failed'); return { ok: false }; }
    },
    async missionAuto() {
      if (!client) return { ok: false };
      try { return await client.missionAuto(); }
      catch (e: any) { setError(e?.message || 'Set AUTO failed'); return { ok: false }; }
    },
    async missionStart() {
      if (!client) return { ok: false };
      try { return await client.missionStart(); }
      catch (e: any) { setError(e?.message || 'Mission start failed'); return { ok: false }; }
    },
    // --- NEW: FCU maintenance/calibration ---
    async fcuReboot() {
      if (!client) return { ok: false };
      try { return await client.fcuReboot(); }
      catch (e: any) { setError(e?.message || 'Reboot failed'); return { ok: false }; }
    },
    async preflightLevel() {
      if (!client) return { ok: false };
      try { return await client.preflightLevel(); }
      catch (e: any) { setError(e?.message || 'Board level failed'); return { ok: false }; }
    },
    async preflightGyro() {
      if (!client) return { ok: false };
      try { return await client.preflightGyro(); }
      catch (e: any) { setError(e?.message || 'Gyro cal failed'); return { ok: false }; }
    },
    async preflightAccel() {
      if (!client) return { ok: false };
      try { return await client.preflightAccel(); }
      catch (e: any) { setError(e?.message || 'Accel cal failed'); return { ok: false }; }
    },
  };
}
