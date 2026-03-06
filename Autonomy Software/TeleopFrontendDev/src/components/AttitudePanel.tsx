// src/components/AttitudePanel.tsx
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  FileButton,
  Grid,
  Group,
  Menu,
  Select,
  Stack,
  Text,
  ActionIcon,
  Tooltip,
  NumberInput,
  Divider,
} from '@mantine/core';
import {
  IconDotsVertical,
  IconUpload,
  IconFolderOpen,
  IconRefresh,
  IconTrash,
} from '@tabler/icons-react';
import { Panel } from './Panel';
import DroneAttitudeView from './DroneAttitudeView';
import {
  pickAndSaveStlHandle,
  getSavedStlHandle,
  ensureReadPermission,
  blobUrlFromHandle,
  clearSavedStlHandle,
  supportsFSAccess,
} from '../utils/stlFS';

type Props = {
  connected: boolean;

  // Telemetry-reported CURRENT mode (from FCU)
  flightMode: string | null;

  // Takes the mode we WANT to send (from dropdown)
  onSetFlightMode?: (mode: string) => void;

  onArm?: () => Promise<any> | void;
  onDisarm?: () => Promise<any> | void;
  onTakeoff?: (altitude?: number) => Promise<any> | void;
  onLand?: () => Promise<any> | void;

  onFcuReboot?: () => Promise<any> | void;
  onPreflightLevel?: () => Promise<any> | void;
  onPreflightGyro?: () => Promise<any> | void;
  onPreflightAccel?: () => Promise<any> | void;

  yaw?: number;
  pitch?: number;
  roll?: number;
  altitude?: number;
  groundspeed?: number;
  gpsSats?: number | null;
  batteryPct?: number | null;

  attitudeModelUrl?: string | null;
};

// Back to the original simple labels your hook was using
const ARDUPILOT_MODES = [
  'Stabilize',
  'Acro',
  'AltHold',
  'Loiter',
  'PosHold',
  'Auto',
  'Guided',
  'RTL',
  'Land',
];

export default function AttitudePanel({
  connected,
  flightMode,
  onSetFlightMode,
  onArm,
  onDisarm,
  onTakeoff,
  onLand,
  onFcuReboot,
  onPreflightLevel,
  onPreflightGyro,
  onPreflightAccel,
  yaw = 0,
  pitch = 0,
  roll = 0,
  altitude = 0,
  groundspeed = 0,
  gpsSats = 0,
  batteryPct = null,
  attitudeModelUrl = null,
}: Props) {
  console.log('[AttitudePanel] render; flightMode (telemetry) =', flightMode);

  const disabled = !connected;

  const yawStr = yaw.toFixed(1);
  const pitchStr = pitch.toFixed(1);
  const rollStr = roll.toFixed(1);
  const altStr = altitude.toFixed(1);
  const gsStr = groundspeed.toFixed(1);
  const satsStr = gpsSats ?? 0;
  const battStr = batteryPct == null ? '—' : `${batteryPct}%`;

  // Takeoff altitude control (meters)
  const [takeoffAlt, setTakeoffAlt] = useState<number>(1.5);

  // LOCAL desired mode for dropdown (no link back to telemetry)
  // Default matches your hook's expectations
  const [selectedMode, setSelectedMode] = useState<string>('Stabilize');

  // STL session + persistent handling
  const [stlSessionUrl, setStlSessionUrl] = useState<string | null>(null);
  const [stlPersistentUrl, setStlPersistentUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!supportsFSAccess()) return;
      try {
        const handle = await getSavedStlHandle();
        if (!handle) return;
        const ok = await ensureReadPermission(handle);
        if (!ok) return;
        const url = await blobUrlFromHandle(handle);
        if (mounted) setStlPersistentUrl(url);
      } catch {
        /* ignore */
      }
    })();

    return () => {
      mounted = false;
      if (stlSessionUrl) URL.revokeObjectURL(stlSessionUrl);
      if (stlPersistentUrl) URL.revokeObjectURL(stlPersistentUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stlUrl = useMemo(
    () => attitudeModelUrl ?? stlSessionUrl ?? stlPersistentUrl ?? null,
    [attitudeModelUrl, stlSessionUrl, stlPersistentUrl],
  );

  const pickPersistent = async () => {
    try {
      setLoading(true);
      const ok = await pickAndSaveStlHandle();
      if (!ok) return;
      const handle = await getSavedStlHandle();
      if (!handle) return;
      const perm = await ensureReadPermission(handle);
      if (!perm) return;
      if (stlSessionUrl) {
        URL.revokeObjectURL(stlSessionUrl);
        setStlSessionUrl(null);
      }
      if (stlPersistentUrl) {
        URL.revokeObjectURL(stlPersistentUrl);
      }
      const url = await blobUrlFromHandle(handle);
      setStlPersistentUrl(url);
    } finally {
      setLoading(false);
    }
  };

  const reloadFromDisk = async () => {
    try {
      setLoading(true);
      const handle = await getSavedStlHandle();
      if (!handle) return;
      const ok = await ensureReadPermission(handle);
      if (!ok) return;
      if (stlPersistentUrl) URL.revokeObjectURL(stlPersistentUrl);
      const url = await blobUrlFromHandle(handle);
      setStlPersistentUrl(url);
    } finally {
      setLoading(false);
    }
  };

  const forgetPersistent = async () => {
    if (stlPersistentUrl) {
      URL.revokeObjectURL(stlPersistentUrl);
      setStlPersistentUrl(null);
    }
    await clearSavedStlHandle();
  };

  return (
    <Panel
      title="Attitude"
      right={
        <Badge color={connected ? 'green' : 'red'}>
          {connected ? 'OK' : 'No Link'}
        </Badge>
      }
    >
      {/* Top bar: Flight mode + arming + takeoff/land */}
      <Group wrap="wrap" gap="sm" align="center">
        <Text fw={700} c="white">
          Flight Mode:
        </Text>

        <Select
          data={ARDUPILOT_MODES}
          value={selectedMode}
          onChange={(value) => {
            console.log('[AttitudePanel] dropdown changed to:', value);
            if (!value) return;
            // value is e.g. 'AltHold'
            setSelectedMode(value);
          }}
          allowDeselect={false}
          styles={{ input: { background: '#151515', color: '#fff' } }}
          size="sm"
        />

        <Button
          size="sm"
          onClick={() => {
            if (!selectedMode) return;
            console.log(
              '[AttitudePanel] Set Flight Mode clicked with label value:',
              selectedMode,
            );
            // This is exactly what your hook used to get
            onSetFlightMode?.(selectedMode);
          }}
          disabled={disabled || !onSetFlightMode || !selectedMode}
        >
          Set Flight Mode
        </Button>

        {/* Takeoff altitude control */}
        <NumberInput
          size="sm"
          min={0.5}
          max={100}
          step={0.5}
          decimalScale={1}
          value={takeoffAlt}
          onChange={(v) => {
            const n = typeof v === 'number' ? v : Number(v);
            setTakeoffAlt(Number.isFinite(n) ? n : 2);
          }}
          styles={{ input: { background: '#151515', color: '#fff', width: 130 } }}
          placeholder="Alt (m)"
        />

        <Group gap="xs" ml="auto" wrap="wrap">
          <Button
            size="sm"
            color="green"
            variant="filled"
            onClick={onArm}
            disabled={disabled || !onArm}
          >
            Arm
          </Button>
          <Button
            size="sm"
            color="red"
            variant="outline"
            onClick={onDisarm}
            disabled={disabled || !onDisarm}
          >
            Disarm
          </Button>
          <Button
            size="sm"
            color="blue"
            variant="filled"
            onClick={() => onTakeoff?.(takeoffAlt)}
            disabled={disabled || !onTakeoff}
          >
            {`Takeoff (${takeoffAlt} m)`}
          </Button>
          <Button
            size="sm"
            color="gray"
            variant="outline"
            onClick={onLand}
            disabled={disabled || !onLand}
          >
            Land
          </Button>
        </Group>
      </Group>

      <Grid mt="sm">
        {/* Left: 3D viewer + STL menu */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card
            radius="md"
            style={{
              background: 'transparent',
              border: '1px solid #2a2a2a',
              height: 220,
              position: 'relative',
            }}
          >
            <div style={{ position: 'absolute', inset: 0 }}>
              <DroneAttitudeView
                stlUrl={stlUrl ?? undefined}
                yawDeg={yaw}
                pitchDeg={pitch}
                rollDeg={roll}
                altitudeM={altitude}
              />
            </div>

            <div style={{ position: 'absolute', top: 6, right: 6 }}>
              <Menu shadow="md" width={220} position="bottom-end" withinPortal>
                <Menu.Target>
                  <Tooltip label="STL options" withArrow>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      aria-label="STL options"
                    >
                      <IconDotsVertical size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Menu.Target>
                <Menu.Dropdown>
                  <Menu.Item leftSection={<IconUpload size={16} />}>
                    <FileButton
                      accept=".stl"
                      onChange={(file) => {
                        if (!file) return;
                        const url = URL.createObjectURL(file);
                        if (stlSessionUrl) URL.revokeObjectURL(stlSessionUrl);
                        setStlSessionUrl(url);
                      }}
                    >
                      {(props) => (
                        <Button
                          {...props}
                          variant="subtle"
                          size="xs"
                          fullWidth
                          style={{ justifyContent: 'flex-start' }}
                        >
                          Load STL (session)
                        </Button>
                      )}
                    </FileButton>
                  </Menu.Item>

                  <Menu.Item
                    leftSection={<IconFolderOpen size={16} />}
                    onClick={pickPersistent}
                    disabled={loading}
                  >
                    Pick STL (persists)
                  </Menu.Item>
                  <Menu.Item
                    leftSection={<IconRefresh size={16} />}
                    onClick={reloadFromDisk}
                    disabled={loading || !stlPersistentUrl}
                  >
                    Reload from disk
                  </Menu.Item>
                  <Menu.Item
                    color="red"
                    leftSection={<IconTrash size={16} />}
                    onClick={forgetPersistent}
                    disabled={!stlPersistentUrl || loading}
                  >
                    Forget persistent
                  </Menu.Item>
                </Menu.Dropdown>
              </Menu>
            </div>
          </Card>
        </Grid.Col>

        {/* Right: metrics + current mode badge */}
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Stack gap="xs">
            <Text
              c="white"
              fw={600}
              style={{
                background: '#151515',
                border: '1px solid #2a2a2a',
                borderRadius: 8,
                padding: '6px 8px',
              }}
            >
              Yaw: {yawStr}° | Pitch: {pitchStr}° | Roll: {rollStr}°
            </Text>
            <Group gap="xs" wrap="wrap">
              <Badge variant="filled" color="dark">
                Live Telemetry
              </Badge>
              <Badge variant="outline" color="dark">
                Altitude: {altStr} m
              </Badge>
              <Badge variant="outline" color="dark">
                Speed: {gsStr} m/s
              </Badge>
              <Badge variant="outline" color="dark">
                GPS: {satsStr} sats
              </Badge>
              <Badge variant="outline" color="dark">
                Battery: {battStr}
              </Badge>
              <Badge variant="outline" color="dark">
                Flight Mode: {flightMode ?? '—'}
              </Badge>
            </Group>
          </Stack>
        </Grid.Col>
      </Grid>

      {/* FCU maintenance */}
      {(onFcuReboot || onPreflightLevel || onPreflightGyro || onPreflightAccel) && (
        <>
          <Divider my="sm" />
          <Stack gap={6}>
            <Text size="sm" fw={600} c="white">
              FCU Maintenance
            </Text>
            <Group wrap="wrap" gap="xs">
              {onFcuReboot && (
                <Button
                  size="xs"
                  color="red"
                  variant="outline"
                  onClick={() => onFcuReboot?.()}
                >
                  Reboot FCU
                </Button>
              )}
              {onPreflightLevel && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => onPreflightLevel?.()}
                >
                  Board Level
                </Button>
              )}
              {onPreflightGyro && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => onPreflightGyro?.()}
                >
                  Gyro Cal
                </Button>
              )}
              {onPreflightAccel && (
                <Button
                  size="xs"
                  variant="default"
                  onClick={() => onPreflightAccel?.()}
                >
                  Accel Cal
                </Button>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              Calibrations require the vehicle to be <b>disarmed</b>, perfectly{' '}
              <b>level</b>, and <b>still</b>.
            </Text>
          </Stack>
        </>
      )}
    </Panel>
  );
}
