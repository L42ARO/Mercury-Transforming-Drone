import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Card, Group, SegmentedControl, Stack, Text, Tooltip, Slider, InputWrapper } from '@mantine/core';
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconCircleFilled, IconSquareRounded } from '@tabler/icons-react';
import { Panel } from './Panel';

// UPDATED: Added 'thermal'
type CameraMode = 'regular' | 'tof' | 'thermal';
type StreamMode = 'mjpeg' | 'poll';

type Props = {
  baseUrl?: string;
  // Regular Camera
  start?: () => Promise<any>;
  stop?: () => Promise<any>;
  status?: () => Promise<any>;
  recordStart?: () => Promise<any>;
  recordStop?: () => Promise<any>;
  recordStatus?: () => Promise<any>;

  // ToF Camera
  startTof?: () => Promise<any>;
  stopTof?: () => Promise<any>;
  statusTof?: () => Promise<any>;
  recordStartTof?: () => Promise<any>;
  recordStopTof?: () => Promise<any>;
  recordStatusTof?: () => Promise<any>;

  // NEW: Thermal Camera
  startThermal?: () => Promise<any>;
  stopThermal?: () => Promise<any>;
  statusThermal?: () => Promise<any>;
  recordStartThermal?: () => Promise<any>;
  recordStopThermal?: () => Promise<any>;
  recordStatusThermal?: () => Promise<any>;

  // URL Helpers
  cameraFeedUrl?: () => string;
  cameraFrameUrl?: () => string;
  tofCameraFeedUrl?: (confidence?: number) => string;
  tofCameraFrameUrl?: (confidence?: number) => string;
  thermalFeedUrl?: () => string;
  thermalFrameUrl?: () => string;
};

export default function LiveCameraPanel({
  baseUrl,
  // Regular
  start, stop, status, recordStart, recordStop, recordStatus,
  // ToF
  startTof, stopTof, statusTof, recordStartTof, recordStopTof, recordStatusTof,
  // Thermal
  startThermal, stopThermal, statusThermal, recordStartThermal, recordStopThermal, recordStatusThermal,
  // URLs
  cameraFeedUrl, cameraFrameUrl, tofCameraFeedUrl, tofCameraFrameUrl, thermalFeedUrl, thermalFrameUrl
}: Props) {
  const [playing, setPlaying] = useState(false);
  const [streamMode, setStreamMode] = useState<StreamMode>('mjpeg');
  const [currentCamera, setCurrentCamera] = useState<CameraMode>('regular');
  const [confidence, setConfidence] = useState(30);
  const [err, setErr] = useState<string | null>(null);
  const [fps, setFps] = useState<number>(0);
  
  // Status flags
  const [camOk, setCamOk] = useState<boolean>(false);
  const [tofCamOk, setTofCamOk] = useState<boolean>(false);
  const [thermalOk, setThermalOk] = useState<boolean>(false); // NEW

  // Recording state
  const [recording, setRecording] = useState<boolean>(false);
  const [recordInfo, setRecordInfo] = useState<{ session_dir?: string; segment_started_at?: string; queue_backlog?: number } | null>(null);
  const [recErr, setRecErr] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const pollTimer = useRef<number | null>(null);
  const framesThisSecond = useRef(0);
  const fpsTimer = useRef<number | null>(null);
  const recStatusTimer = useRef<number | null>(null);

  // --- Dynamic URL calculation ---
  const currentFeedUrl = useMemo(() => {
    if (!baseUrl) return '';
    if (currentCamera === 'tof') {
      return tofCameraFeedUrl ? tofCameraFeedUrl(confidence) : `${baseUrl}/tof_camera/feed?confidence=${confidence}`;
    }
    if (currentCamera === 'thermal') {
      return thermalFeedUrl ? thermalFeedUrl() : `${baseUrl}/thermal/feed`;
    }
    return cameraFeedUrl ? cameraFeedUrl() : `${baseUrl}/camera/feed`;
  }, [baseUrl, currentCamera, confidence, cameraFeedUrl, tofCameraFeedUrl, thermalFeedUrl]);

  const currentFrameUrl = useMemo(() => {
    if (!baseUrl) return '';
    if (currentCamera === 'tof') {
      return tofCameraFrameUrl ? tofCameraFrameUrl(confidence) : `${baseUrl}/tof_camera/frame?confidence=${confidence}`;
    }
    if (currentCamera === 'thermal') {
        return thermalFrameUrl ? thermalFrameUrl() : `${baseUrl}/thermal/frame`;
    }
    return cameraFrameUrl ? cameraFrameUrl() : `${baseUrl}/camera/frame`;
  }, [baseUrl, currentCamera, confidence, cameraFrameUrl, tofCameraFrameUrl, thermalFrameUrl]);

  // --- FPS ---
  const startFpsCounter = () => {
    stopFpsCounter();
    framesThisSecond.current = 0;
    fpsTimer.current = window.setInterval(() => {
      setFps(framesThisSecond.current);
      framesThisSecond.current = 0;
    }, 1000);
  };
  const stopFpsCounter = () => {
    if (fpsTimer.current) { window.clearInterval(fpsTimer.current); fpsTimer.current = null; }
    setFps(0);
  };
  const handleStreamFrame = () => {
    if (streamMode === 'mjpeg' && playing) framesThisSecond.current += 1;
  };

  // --- HTTP Poll ---
  const beginPoll = () => {
    if (!currentFrameUrl) return;
    stopPoll();
    startFpsCounter();
    const tick = async () => {
      try {
        const res = await fetch(withCacheBust(currentFrameUrl), { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        if (imgRef.current) {
          imgRef.current.src = url;
          framesThisSecond.current += 1;
        }
        setTimeout(() => URL.revokeObjectURL(url), 500);
      } catch (e: any) {
        setErr(e?.message || 'Frame fetch failed');
      } finally {
        pollTimer.current = window.setTimeout(tick, 0) as unknown as number;
      }
    };
    tick();
  };

  const stopPoll = () => {
    if (pollTimer.current) { window.clearTimeout(pollTimer.current); pollTimer.current = null; }
    stopFpsCounter();
  };

  // --- Unified START Action (All 3) ---
  const doStart = async () => {
    if (!baseUrl || !start || !startTof || !startThermal) return;
    setErr(null);
    try {
      // Start Regular, ToF, and Thermal simultaneously
      const [rCam, rTof, rTherm] = await Promise.all([start(), startTof(), startThermal()]);
      
      if (!rCam.ok || !rTof.ok || !rTherm.ok) {
        const fails = [];
        if(!rCam.ok) fails.push('RGB');
        if(!rTof.ok) fails.push('ToF');
        if(!rTherm.ok) fails.push('Thermal');
        throw new Error(`Start failed for: ${fails.join(', ')}`);
      }
      
      setPlaying(true);
      if (streamMode === 'poll') beginPoll();
      else startFpsCounter();
      refreshStatus();
    } catch (e: any) {
      setErr(e?.message || 'Failed to start cameras');
      setPlaying(false);
      stopPoll();
    }
  };

  // --- Unified STOP Action (All 3) ---
  const doStop = async () => {
    if (!baseUrl || !stop || !stopTof || !stopThermal) return;
    setErr(null);
    try {
      const [rCam, rTof, rTherm] = await Promise.all([stop(), stopTof(), stopThermal()]);
      if (!rCam.ok || !rTof.ok || !rTherm.ok) {
         // We usually don't throw here to ensure UI resets, but logging is good
         console.warn("Some cameras failed to stop cleanly");
      }
    } catch (e: any) {
      setErr(e?.message || 'Failed to stop cameras');
    } finally {
      setPlaying(false);
      stopPoll();
      stopFpsCounter();
      setCamOk(false);
      setTofCamOk(false);
      setThermalOk(false);
    }
  };

  // --- Unified RECORD START (All 3) ---
  const doRecordStart = async () => {
    if (!baseUrl || !recordStart || !recordStartTof || !recordStartThermal) return;
    try {
      setRecErr(null);
      const [rCam, rTof, rTherm] = await Promise.all([recordStart(), recordStartTof(), recordStartThermal()]);
      
      if (!rCam.ok || !rTof.ok || !rTherm.ok) {
        throw new Error(`Record start failed on some devices`);
      }
      setRecording(true);
      refreshRecordingStatusOnly();
    } catch (e: any) {
      setRecErr(e?.message || 'Failed to start multi-recording');
    }
  };

  // --- Unified RECORD STOP (All 3) ---
  const doRecordStop = async () => {
    if (!baseUrl || !recordStop || !recordStopTof || !recordStopThermal) return;
    try {
      setRecErr(null);
      const [rCam, rTof, rTherm] = await Promise.all([recordStop(), recordStopTof(), recordStopThermal()]);
      if (!rCam.ok || !rTof.ok || !rTherm.ok) {
        throw new Error(`Record stop error on some devices`);
      }
      setRecording(false);
      refreshRecordingStatusOnly();
    } catch (e: any) {
      setRecErr(e?.message || 'Failed to stop multi-recording');
    }
  };

  // --- Status Updates ---
  const refreshStatus = async () => {
    if (!baseUrl || !status || !statusTof || !statusThermal) return;
    try {
      const [res, resTof, resTherm] = await Promise.all([status(), statusTof(), statusThermal()]);

      setCamOk(!!(res?.running ?? res?.ok));
      setTofCamOk(!!(resTof?.running ?? resTof?.ok));
      setThermalOk(!!(resTherm?.running ?? resTherm?.ok));

      // Use Regular camera as the "Master" recording status for the badge
      if (res?.recording) {
        setRecording(Boolean(res.recording.recording));
        setRecordInfo({
          session_dir: res.recording.session_dir,
          segment_started_at: res.recording.segment_started_at,
          queue_backlog: res.recording.queue_backlog,
        });
      }
    } catch (e: any) {
      setCamOk(false);
      setTofCamOk(false);
      setThermalOk(false);
      setErr(e?.message || 'Status error');
    }
  };

  const refreshRecordingStatusOnly = async () => {
    if (!baseUrl || !recordStatus) return;
    try {
      const r = await recordStatus();
      const rec = r?.recording || r;
      setRecording(Boolean(rec?.recording));
      setRecordInfo({
        session_dir: rec?.session_dir,
        segment_started_at: rec?.segment_started_at,
        queue_backlog: rec?.queue_backlog,
      });
      setRecErr(null);
    } catch (e: any) {
      setRecErr(e?.message || 'Recording status error');
    }
  };

  useEffect(() => () => { stopPoll(); }, []);

  useEffect(() => {
    if (!playing) return;
    if (streamMode === 'poll') { beginPoll(); }
    else { stopPoll(); startFpsCounter(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streamMode, playing]);

  useEffect(() => {
    if (!playing) return;
    if (streamMode === 'mjpeg') {
      setPlaying(false);
      setTimeout(() => setPlaying(true), 1);
    } else {
      beginPoll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentCamera, confidence]);

  useEffect(() => { refreshStatus(); }, [baseUrl]);
  useEffect(() => {
    if (!baseUrl) return;
    recStatusTimer.current && window.clearInterval(recStatusTimer.current);
    recStatusTimer.current = window.setInterval(() => { refreshRecordingStatusOnly(); }, 3000) as unknown as number;
    return () => { if (recStatusTimer.current) window.clearInterval(recStatusTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  const recordingSince = (() => {
    const iso = recordInfo?.segment_started_at;
    if (!iso) return null;
    const started = new Date(iso).getTime();
    const now = Date.now();
    const sec = Math.max(0, Math.floor((now - started) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  })();

  const withCacheBust = (url: string) => `${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`;

  // Helper to determine badge color/text based on selected view
  const getStatusBadge = () => {
      if (currentCamera === 'tof') {
          return <Badge color={tofCamOk ? 'blue' : 'gray'}>{tofCamOk ? 'ToF Running' : 'ToF Stopped'}</Badge>;
      } else if (currentCamera === 'thermal') {
          return <Badge color={thermalOk ? 'orange' : 'gray'}>{thermalOk ? 'Thermal Running' : 'Thermal Stopped'}</Badge>;
      }
      return <Badge color={camOk ? 'green' : 'red'}>{camOk ? 'RGB Running' : 'RGB Stopped'}</Badge>;
  };

  return (
    <Panel
      title="Live Camera"
      right={
        <Group gap="xs">
          {getStatusBadge()}
          <Badge variant="outline">FPS: {fps}</Badge>
          {recording ? (
            <Badge color="red" variant="filled">REC {recordingSince ? `• ${recordingSince}` : '•'}</Badge>
          ) : (
            <Badge variant="outline" color="gray">Idle</Badge>
          )}
        </Group>
      }
    >
      <Stack gap="sm">
        <Group justify="space-between" wrap="wrap">
          {/* Camera Mode Toggle */}
          <SegmentedControl
            value={currentCamera}
            onChange={(v) => setCurrentCamera(v as CameraMode)}
            data={[
              { label: 'Regular RGB', value: 'regular' },
              { label: 'ToF Depth', value: 'tof' },
              { label: 'Thermal', value: 'thermal' }, // NEW OPTION
            ]}
            disabled={!baseUrl}
          />

          <SegmentedControl
            value={streamMode}
            onChange={(v) => setStreamMode(v as StreamMode)}
            data={[
              { label: 'MJPEG', value: 'mjpeg' },
              { label: 'Poll', value: 'poll' },
            ]}
            disabled={!baseUrl || playing}
          />

          <Group>
            <Button leftSection={<IconRefresh size={16} />} variant="light" onClick={refreshStatus} disabled={!baseUrl}>
              Status
            </Button>

            {!recording ? (
              <Tooltip label="Start recording on ALL cameras" withArrow>
                <Button
                  variant="light"
                  color="red"
                  leftSection={<IconCircleFilled size={16} />}
                  onClick={doRecordStart}
                  // Enable record if AT LEAST one is running
                  disabled={!baseUrl || (!camOk && !tofCamOk && !thermalOk)}
                >
                  Record
                </Button>
              </Tooltip>
            ) : (
              <Tooltip label="Stop recording on ALL cameras" withArrow>
                <Button
                  variant="light"
                  color="gray"
                  leftSection={<IconSquareRounded size={16} />}
                  onClick={doRecordStop}
                  disabled={!baseUrl}
                >
                  Stop Rec
                </Button>
              </Tooltip>
            )}

            {!playing ? (
              <Button leftSection={<IconPlayerPlay size={16} />} onClick={doStart} disabled={!baseUrl}>
                Start
              </Button>
            ) : (
              <Button color="red" leftSection={<IconPlayerStop size={16} />} onClick={doStop}>
                Stop
              </Button>
            )}
          </Group>
        </Group>

        {currentCamera === 'tof' && (
          <InputWrapper label={`ToF Confidence Threshold: ${confidence}`} description="Pixels below this confidence are shown as black." style={{ padding: '0 10px' }}>
            <Slider
              value={confidence}
              onChange={setConfidence}
              min={0}
              max={255}
              step={5}
              marks={[{ value: 30, label: '30' }]}
              color="blue"
            />
          </InputWrapper>
        )}

        <Card radius="md" style={{ background: '#000', height: 340, border: '1px solid #2a2a2a', overflow: 'hidden' }}>
          {streamMode === 'mjpeg' ? (
            <img
              src={playing && baseUrl ? withCacheBust(currentFeedUrl) : undefined}
              alt="Live camera"
              onLoad={handleStreamFrame}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          ) : (
            <img
              ref={imgRef}
              alt="Live camera (polled)"
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          )}
        </Card>

        {/* Info / Error Section */}
        {recordInfo?.session_dir && (
          <Text size="sm" c="dimmed">
            Session: <Text span fw={600}>{recordInfo.session_dir}</Text>
          </Text>
        )}
        {recErr && <Text c="red" size="sm">{recErr}</Text>}
        {err && <Text c="red" size="sm">{err}</Text>}
        {!baseUrl && <Text c="dimmed">Set a robot IP to enable the camera.</Text>}
      </Stack>
    </Panel>
  );
}