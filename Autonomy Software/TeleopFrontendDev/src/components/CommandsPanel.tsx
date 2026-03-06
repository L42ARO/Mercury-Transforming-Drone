import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Group,
  SimpleGrid,
  Slider,
  Stack,
  Switch,
  Text,
} from '@mantine/core';
import {
  IconKeyboard,
  IconPlayerStop,
  IconArrowUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowRight,
  IconArrowUpLeft,
  IconArrowUpRight,
  IconArrowDownLeft,
  IconArrowDownRight,
} from '@tabler/icons-react';
import { Panel } from './Panel';

type DriveFn = (
  cmd: 'forward' | 'backward' | 'left' | 'right' | 'mix',
  payload?: { speed?: number; left?: number; right?: number }
) => void;

type Props = {
  modeBusy: boolean;
  error?: string | null;
  drive: DriveFn;
  stop: () => void;
  sendModeCar?: () => void;
  sendModeDrone?: () => void;
};

// ===== Debug logging helper =====
const DEBUG = true;
function log(...args: any[]) {
  if (DEBUG) console.log('[CommandsPanel]', ...args);
}

type LastCmd =
  | 'stop'
  | { cmd: 'forward' | 'backward' | 'left' | 'right'; speed: number }
  | { cmd: 'mix'; l: number; r: number };

type DiscreteCmd = 'forward' | 'backward' | 'left' | 'right';
type ArcDir = 'fwdLeft' | 'fwdRight' | 'backLeft' | 'backRight';

export default function CommandsPanel({
  modeBusy,
  error,
  drive,
  stop,
  sendModeCar,
  sendModeDrone,
}: Props) {
  const [speed, setSpeed] = useState(50);

  const [keyboardMode, setKeyboardMode] = useState(false);
  const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());

  // Speed override: if false -> use tuned per-direction defaults (with multiplier), slider hidden
  // if true -> use `speed` slider value as base for everything
  const [useCustomSpeed, setUseCustomSpeed] = useState(false);

  // Multiplier for default profile (1x, 2x, 3x)
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(1);

  // gate stop on “ever drove” to avoid spamming stop at idle (still used for unmount safety)
  const [armed, setArmed] = useState(false);
  const armedRef = useRef(armed);
  useEffect(() => {
    armedRef.current = armed;
  }, [armed]);

  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  // stop on unmount only if we had armed
  useEffect(() => {
    return () => {
      if (armedRef.current) stopRef.current();
    };
  }, []);

  const lastCmdRef = useRef<LastCmd>('stop');

  // ALWAYS send stop (matches Stop button behavior)
  const safeStop = useCallback(() => {
    log('safeStop() invoked. lastCmd was', lastCmdRef.current);
    try {
      stopRef.current();
    } catch {}
    lastCmdRef.current = 'stop';
  }, []);

  const armOnce = () => {
    if (!armedRef.current) {
      setArmed(true);
      log('armOnce() -> armed');
    }
  };

  // ===== send helpers with dedupe =====
  const sendDiscrete = useCallback(
    (cmd: 'forward' | 'backward' | 'left' | 'right', speedVal: number) => {
      armOnce();
      const prev = lastCmdRef.current;
      if (
        prev !== 'stop' &&
        (prev as any).cmd === cmd &&
        (prev as any).speed === speedVal
      ) {
        log('sendDiscrete deduped:', cmd, speedVal);
        return;
      }
      log('sendDiscrete:', cmd, speedVal);
      drive(cmd, { speed: speedVal });
      lastCmdRef.current = { cmd, speed: speedVal };
    },
    [drive]
  );

  const sendMix = useCallback(
    (left: number, right: number) => {
      armOnce();
      const prev = lastCmdRef.current;
      if (
        prev !== 'stop' &&
        (prev as any).cmd === 'mix' &&
        (prev as any).l === left &&
        (prev as any).r === right
      ) {
        log('sendMix deduped:', { left, right });
        return;
      }
      log('sendMix:', { left, right });
      drive('mix', { left, right });
      lastCmdRef.current = { cmd: 'mix', l: left, r: right };
    },
    [drive]
  );

  // ===== Speed profile helpers =====

  // Apply multiplier to a signed value, clamped to [-100, 100]
  const applyMultiplierSigned = useCallback(
    (value: number): number => {
      if (speedMultiplier === 1) return value;
      const sign = Math.sign(value) || 1;
      const mag = Math.abs(value) * speedMultiplier;
      return sign * clamp(mag, 0, 100);
    },
    [speedMultiplier]
  );

  // Map single-axis commands to a base speed (always positive magnitude)
  const getBaseForDiscrete = useCallback(
    (cmd: DiscreteCmd): number => {
      if (useCustomSpeed) {
        return clamp(speed, 0, 100);
      }

      // Default per-direction speeds (in %)
      let base = 0;
      switch (cmd) {
        case 'forward':
          base = 24;
          break;
        case 'backward':
          base = 30;
          break;
        case 'left':
        case 'right':
          base = 37;
          break;
        default:
          base = 0;
      }

      const scaled = base * speedMultiplier;
      return clamp(scaled, 0, 100);
    },
    [useCustomSpeed, speed, speedMultiplier]
  );

  // Map diagonal / arc commands to (left,right) mix
  const getMixForDirection = useCallback(
    (dir: ArcDir): [number, number] => {
      if (useCustomSpeed) {
        const base = clamp(speed, 0, 100);
        switch (dir) {
          case 'fwdLeft':
            return arcForward(base, 'left');
          case 'fwdRight':
            return arcForward(base, 'right');
          case 'backLeft':
            return arcBackward(base, 'left');
          case 'backRight':
            return arcBackward(base, 'right');
        }
      }

      // Default tuned mix (unscaled):
      // Forward/backward diagonals: highest motor 37%, lowest 20% (signed)
      switch (dir) {
        case 'fwdLeft': {
          const l = applyMultiplierSigned(20);
          const r = applyMultiplierSigned(37);
          return [l, r];
        }
        case 'fwdRight': {
          const l = applyMultiplierSigned(37);
          const r = applyMultiplierSigned(20);
          return [l, r];
        }
        case 'backLeft': {
          const l = applyMultiplierSigned(-20);
          const r = applyMultiplierSigned(-37);
          return [l, r];
        }
        case 'backRight': {
          const l = applyMultiplierSigned(-37);
          const r = applyMultiplierSigned(-20);
          return [l, r];
        }
        default:
          return [0, 0];
      }
    },
    [useCustomSpeed, speed, applyMultiplierSigned]
  );

  // ===== GLOBAL KEYDOWN (capture) -> logs all keys; P triggers STOP anywhere =====
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl ? activeEl.tagName : 'NONE';
      const meta = {
        code: e.code,
        key: e.key,
        repeat: e.repeat,
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        metaKey: e.metaKey,
        activeTag,
        keyboardMode,
      };
      // Log EVERY keydown so we can see what the browser emits
      log('keydown (global/capture):', meta);

      // P (KeyP) acts as STOP regardless of keyboardMode
      const isP = e.code === 'KeyP' || e.key === 'p' || e.key === 'P';
      if (isP) {
        e.preventDefault();
        log('P detected -> STOP');
        setPressedKeys(new Set()); // ensure no resume on keyup
        safeStop(); // <-- un-conditional stop (matches Stop button)
      }
    };
    document.addEventListener('keydown', onGlobalKeyDown, { capture: true });
    log('Global keydown listener attached (capture=true)');
    return () => {
      document.removeEventListener(
        'keydown',
        onGlobalKeyDown,
        { capture: true } as any
      );
      log('Global keydown listener removed');
    };
  }, [keyboardMode, safeStop]);

  // ===== Keyboard: WASD handled when keyboardMode is ON (with logs) =====
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!keyboardMode) return;
      const key = (e.key || '').toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(key)) return;
      setPressedKeys((prev) => {
        if (prev.has(key)) {
          log('WASD keydown deduped:', key);
          return prev;
        }
        const next = new Set([...prev, key]);
        log('WASD keydown -> pressedKeys =', Array.from(next));
        return next;
      });
    },
    [keyboardMode]
  );

  const onKeyUp = useCallback(
    (e: KeyboardEvent) => {
      if (!keyboardMode) return;
      const key = (e.key || '').toLowerCase();
      if (!['w', 'a', 's', 'd'].includes(key)) return;
      setPressedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        log('WASD keyup -> pressedKeys =', Array.from(next));
        return next;
      });
    },
    [keyboardMode]
  );

  useEffect(() => {
    if (!keyboardMode) return;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    log('WASD listeners attached (keyboardMode=true)');
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      log('WASD listeners removed (keyboardMode change/unmount)');
    };
  }, [keyboardMode, onKeyDown, onKeyUp]);

  // Map WASD state to drive commands (with logs) + speed profiles
  useEffect(() => {
    if (!keyboardMode) return;

    const w = pressedKeys.has('w');
    const s = pressedKeys.has('s');
    const a = pressedKeys.has('a');
    const d = pressedKeys.has('d');

    const idle = (!w && !s && !a && !d) || (w && s);

    log('WASD state:', {
      w,
      a,
      s,
      d,
      idle,
      useCustomSpeed,
      speed,
      speedMultiplier,
    });

    if (idle) {
      if (lastCmdRef.current !== 'stop') {
        log('WASD idle -> STOP');
        safeStop();
      }
      return;
    }

    // Single-axis -> discrete commands (use per-direction mapping)
    if (w && !s && !a && !d) {
      const v = getBaseForDiscrete('forward');
      sendDiscrete('forward', v);
      return;
    }
    if (s && !w && !a && !d) {
      const v = getBaseForDiscrete('backward');
      sendDiscrete('backward', v);
      return;
    }
    if (a && !d && !w && !s) {
      const v = getBaseForDiscrete('left');
      sendDiscrete('left', v);
      return;
    }
    if (d && !a && !w && !s) {
      const v = getBaseForDiscrete('right');
      sendDiscrete('right', v);
      return;
    }

    // Combos -> mix
    let left = 0,
      right = 0;

    if (w && !s) {
      if (a && !d) {
        [left, right] = getMixForDirection('fwdLeft');
      } else if (d && !a) {
        [left, right] = getMixForDirection('fwdRight');
      } else {
        const v = getBaseForDiscrete('forward');
        left = v;
        right = v;
      }
    } else if (s && !w) {
      if (a && !d) {
        [left, right] = getMixForDirection('backLeft');
      } else if (d && !a) {
        [left, right] = getMixForDirection('backRight');
      } else {
        const v = getBaseForDiscrete('backward');
        left = -v;
        right = -v;
      }
    } else if (!w && !s) {
      if (a && !d) {
        const v = getBaseForDiscrete('left');
        left = v;
        right = -v;
      }
      if (d && !a) {
        const v = getBaseForDiscrete('right');
        left = -v;
        right = v;
      }
    }

    if (left === 0 && right === 0) {
      if (lastCmdRef.current !== 'stop') {
        log('No movement computed -> STOP');
        safeStop();
      }
      return;
    }
    sendMix(left, right);
  }, [
    pressedKeys,
    keyboardMode,
    useCustomSpeed,
    speed,
    speedMultiplier,
    safeStop,
    sendDiscrete,
    sendMix,
    getBaseForDiscrete,
    getMixForDirection,
  ]);

  // ===== Buttons =====
  const actions = {
    fwdLeft: () => {
      const [l, r] = getMixForDirection('fwdLeft');
      sendMix(l, r);
    },
    fwd: () => {
      const v = getBaseForDiscrete('forward');
      sendDiscrete('forward', v);
    },
    fwdRight: () => {
      const [l, r] = getMixForDirection('fwdRight');
      sendMix(l, r);
    },
    left: () => {
      const v = getBaseForDiscrete('left');
      sendDiscrete('left', v);
    },
    right: () => {
      const v = getBaseForDiscrete('right');
      sendDiscrete('right', v);
    },
    backLeft: () => {
      const [l, r] = getMixForDirection('backLeft');
      sendMix(l, r);
    },
    back: () => {
      const v = getBaseForDiscrete('backward');
      sendDiscrete('backward', v);
    },
    backRight: () => {
      const [l, r] = getMixForDirection('backRight');
      sendMix(l, r);
    },
  };

  return (
    <Panel title="Commands">
      <Stack align="center" gap="md" w="100%">
        {/* One-shot mode switches */}
        <Group w="100%" justify="center">
          {sendModeCar && (
            <ModeButton label="Car Mode" busy={modeBusy} onClick={sendModeCar} />
          )}
          {sendModeDrone && (
            <ModeButton
              label="Drone Mode"
              busy={modeBusy}
              onClick={sendModeDrone}
            />
          )}
        </Group>

        {/* Keyboard toggle */}
        <Group justify="space-between" w="100%">
          <Text c="white" fw={600}>
            Keyboard Control
          </Text>
          <Switch
            color="yellow"
            size="md"
            onLabel={<IconKeyboard size={14} />}
            offLabel="OFF"
            checked={keyboardMode}
            onChange={(e) => {
              log('Keyboard toggle ->', e.currentTarget.checked);
              setPressedKeys(new Set());
              setKeyboardMode(e.currentTarget.checked);
              safeStop();
            }}
          />
        </Group>

        {/* Speed override toggle */}
        <Group justify="space-between" w="100%">
          <Text c="white" fw={600}>
            Speed Override
          </Text>
          <Switch
            color="yellow"
            size="md"
            checked={useCustomSpeed}
            onChange={(e) => {
              const enabled = e.currentTarget.checked;
              log('Speed override toggle ->', enabled);
              setUseCustomSpeed(enabled);
              safeStop(); // avoid surprises on profile switch
            }}
          />
        </Group>

        {/* Default speed multiplier (only meaningful when override is OFF) */}
        <Group justify="space-between" w="100%">
          <Text c="white" fw={600}>
            Default Speed Multiplier
          </Text>
          <Group gap="xs">
            {[1, 2, 3].map((m) => (
              <Button
                key={m}
                size="xs"
                variant={speedMultiplier === m ? 'filled' : 'outline'}
                onClick={() => {
                  log('Speed multiplier set ->', m);
                  setSpeedMultiplier(m);
                }}
                disabled={useCustomSpeed}
              >
                {m}x
              </Button>
            ))}
          </Group>
        </Group>

        {/* Button pad (only when not in keyboard mode) */}
        {!keyboardMode && (
          <SimpleGrid cols={3} spacing="sm" w="100%">
            <HoldButton
              label="Forward Left"
              icon={<IconArrowUpLeft />}
              loading={modeBusy}
              onStart={() => actions.fwdLeft()}
              onStop={safeStop}
            />
            <HoldButton
              label="Forward"
              icon={<IconArrowUp />}
              loading={modeBusy}
              onStart={() => actions.fwd()}
              onStop={safeStop}
            />
            <HoldButton
              label="Forward Right"
              icon={<IconArrowUpRight />}
              loading={modeBusy}
              onStart={() => actions.fwdRight()}
              onStop={safeStop}
            />
            <HoldButton
              label="Left"
              icon={<IconArrowLeft />}
              loading={modeBusy}
              onStart={() => actions.left()}
              onStop={safeStop}
            />
            <Button color="red" onClick={safeStop} aria-label="Stop">
              <IconPlayerStop />
            </Button>
            <HoldButton
              label="Right"
              icon={<IconArrowRight />}
              loading={modeBusy}
              onStart={() => actions.right()}
              onStop={safeStop}
            />
            <HoldButton
              label="Back Left"
              icon={<IconArrowDownLeft />}
              loading={modeBusy}
              onStart={() => actions.backLeft()}
              onStop={safeStop}
            />
            <HoldButton
              label="Back"
              icon={<IconArrowDown />}
              loading={modeBusy}
              onStart={() => actions.back()}
              onStop={safeStop}
            />
            <HoldButton
              label="Back Right"
              icon={<IconArrowDownRight />}
              loading={modeBusy}
              onStart={() => actions.backRight()}
              onStop={safeStop}
            />
          </SimpleGrid>
        )}

        {/* Slider only when override is enabled */}
        {useCustomSpeed && (
          <Group w="100%" mt="sm">
            <Text c="white" fw={600}>
              Speed:
            </Text>
            <Slider
              value={speed}
              onChange={(v) => {
                setSpeed(v);
                log('Speed set ->', v);
              }}
              labelAlwaysOn
              style={{ flex: 1 }}
            />
            <Text c="white" fw={600}>
              {speed}%
            </Text>
          </Group>
        )}

        <Text c="dimmed" size="sm">
          WASD = movement. Press{' '}
          <Text span fw={700}>
            P
          </Text>{' '}
          anywhere to STOP (watch console).
        </Text>

        {error && (
          <Text c="red" mt="xs">
            Error: {error}
          </Text>
        )}
      </Stack>
    </Panel>
  );
}

/* --- UI helpers --- */
function ModeButton({
  label,
  busy,
  onClick,
}: {
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  const guard = useRef(false);
  const handleClick = () => {
    if (busy || guard.current) return;
    guard.current = true;
    try {
      onClick();
    } finally {
      setTimeout(() => (guard.current = false), 0);
    }
  };
  return (
    <Button variant="filled" loading={busy} onClick={handleClick} aria-label={label}>
      {label}
    </Button>
  );
}

function HoldButton({
  icon,
  label,
  loading,
  onStart,
  onStop,
}: {
  icon: React.ReactNode;
  label: string;
  loading?: boolean;
  onStart: () => void;
  onStop: () => void;
}) {
  const [active, setActive] = useState(false);
  useEffect(
    () => () => {
      if (active) onStop();
    },
    [active, onStop]
  );
  const down = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setActive(true);
    onStart();
  };
  const up = () => {
    if (active) {
      setActive(false);
      onStop();
    }
  };
  return (
    <Button
      variant={active ? 'filled' : 'light'}
      loading={loading}
      aria-label={label}
      aria-pressed={active}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onPointerLeave={up}
    >
      {icon}
    </Button>
  );
}

/* --- Motion helpers --- */
const TURN_GAIN = 0.2;
const MIN_SIDE_RATIO = 0.85;
function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}
function calcTurnDelta(base: number) {
  return Math.round(base * TURN_GAIN);
}
function arcForward(base: number, turn: 'left' | 'right'): [number, number] {
  const delta = calcTurnDelta(base);
  const floor = Math.round(base * MIN_SIDE_RATIO);
  return turn === 'left'
    ? [Math.max(floor, base - delta), base]
    : [base, Math.max(floor, base - delta)];
}
function arcBackward(base: number, turn: 'left' | 'right'): [number, number] {
  const delta = calcTurnDelta(base);
  const floor = Math.round(base * MIN_SIDE_RATIO);
  return turn === 'left'
    ? [-(Math.max(floor, base - delta)), -base]
    : [-base, -(Math.max(floor, base - delta))];
}
