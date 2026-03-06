import { Badge, Button, Group, NumberInput, Text } from '@mantine/core';
import { useRef, useState } from 'react';
import { Panel } from './Panel';

export type VehicleMode = 'car' | 'drone' | null;

type Props = {
  vehicleMode: VehicleMode;
  modeBusy: boolean;
  onChangeMode: (m: Exclude<VehicleMode, null>) => Promise<void> | void;
  onLock: (holdMs?: number) => Promise<void> | void;
  onUnlock: () => Promise<void> | void;
};

export default function VehicleModePanel({
  vehicleMode,
  modeBusy,
  onChangeMode,
  onLock,
  onUnlock,
}: Props) {
  const [holdMs, setHoldMs] = useState<string | number>(1000);

  // Optional: guard against super-fast double taps
  const callingRef = useRef(false);
  const callOnce = async (fn: () => Promise<void> | void) => {
    if (callingRef.current) return;
    callingRef.current = true;
    try {
      await fn();
    } finally {
      // small delay to avoid accidental double-triggers
      setTimeout(() => { callingRef.current = false; }, 250);
    }
  };

  const handleHoldChange = (v: string | number) => {
    if (v === '') setHoldMs('');
    else setHoldMs(Number(v));
  };

  const badgeColor =
    modeBusy ? 'yellow' : vehicleMode === 'car' ? 'green' : vehicleMode === 'drone' ? 'blue' : 'gray';

  const handleChangeMode = (mode: 'car' | 'drone') =>
    callOnce(() => onChangeMode(mode));

  return (
    <Panel
      title="Vehicle Mode"
      right={
        <Badge color={badgeColor}>
          {modeBusy
            ? 'Switching…'
            : vehicleMode
              ? (vehicleMode === 'car' ? 'Car' : 'Air (Drone)')
              : 'Not set'}
        </Badge>
      }
    >
      <Group align="center" gap="md" wrap="wrap">
        <Text c="white" fw={600}>Tap to change mode:</Text>

        <Button
          color="green"
          onPointerDown={() => handleChangeMode('car')}
          disabled={modeBusy}
        >
          Car Mode
        </Button>

        <Button
          color="blue"
          onPointerDown={() => handleChangeMode('drone')}
          disabled={modeBusy}
        >
          Drone Mode
        </Button>
      </Group>

      <Group mt="md" align="center" gap="sm" wrap="wrap">
        <NumberInput
          label="Lock hold (ms)"
          value={holdMs}
          onChange={handleHoldChange}
          min={0}
          max={65535}
          clampBehavior="strict"
          disabled={modeBusy}
          styles={{ input: { background: '#151515', color: '#fff' }, label: { color: '#bbb' } }}
          placeholder="Default (firmware)"
          w={180}
        />
        <Button
          onClick={() => (holdMs === '' ? onLock() : onLock(Number(holdMs)))}
          disabled={modeBusy}
        >
          LOCK
        </Button>
        <Button variant="outline" onClick={() => onUnlock()} disabled={modeBusy}>
          UNLOCK
        </Button>
      </Group>
    </Panel>
  );
}
