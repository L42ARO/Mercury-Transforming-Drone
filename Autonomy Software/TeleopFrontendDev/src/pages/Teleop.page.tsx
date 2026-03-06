// src/pages/TeleopPage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  AppShell, 
  ActionIcon, 
  Badge, 
  Container, 
  Grid, 
  Group, 
  Text, 
  Title, 
  rem, 
  Tabs,
  Drawer,       // Import Drawer
  Stack,        // Import Stack for vertical layout in drawer
  Button,       // Import Button for clearer mobile actions
  Affix         // Import Affix to float the menu button
} from '@mantine/core';
import { useMediaQuery, useDisclosure } from '@mantine/hooks'; // Import useDisclosure
import { 
  IconLogout, 
  IconRefresh, 
  IconDashboard, 
  IconDrone, 
  IconMap, 
  IconTerminal, 
  IconVideo,
  IconMenu2     // Import a menu icon
} from '@tabler/icons-react';
import { useRobot } from '../hooks/useRobot';
import { useTelemetry } from '../hooks/useTelemetry';
import VehicleModePanel, { VehicleMode } from '../components/VehicleModePanel';
import AttitudePanel from '../components/AttitudePanel';
import MissionPlannerPanel from '../components/MissionPlannerPanel';
import CommandsPanel from '../components/CommandsPanel';
import LiveCameraPanel from '../components/LiveCameraPanel';

const STORAGE_KEY = 'robot_ip';

export function TeleopPage() {
  const navigate = useNavigate();

  // 1. UPDATED BREAKPOINT: Increased to 64em (approx 1024px) 
  // to catch iPhone Pro Max in landscape mode.
  const isMobile = useMediaQuery('(max-width: 64em)'); 
  
  // 2. DRAWER STATE: For the mobile menu
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
   
  const [ip, setIp] = useState<string | null>(null);
  const [flightMode, setFlightMode] = useState<string | null>('Stabilize');
  const [vehicleMode, setVehicleModeLocal] = useState<VehicleMode>(null);
  const [modeBusy, setModeBusy] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) { navigate('/', { replace: true }); return; }
    setIp(saved);
  }, [navigate]);

  const {
    client, connected, error, connect, setMode: setVehicleModeRemote,
    drive, stop, lock, unlock, arm, disarm, takeoff, land, setAutopilotFlightMode,
    missionDownload, missionUpload, missionClear, missionAuto, missionStart,
    fcuReboot, preflightLevel, preflightGyro, preflightAccel,
    startCamera, stopCamera, cameraStatus, recordStart, recordStop, recordStatus,
    startTofCamera, stopTofCamera, tofCameraStatus, tofRecordStart, tofRecordStop, tofRecordStatus,
    startThermal, stopThermal, thermalStatus, thermalRecordStart, thermalRecordStop, thermalRecordStatus,
  } = useRobot(ip);

  const telemetry = useTelemetry(client?.baseUrl);

  useEffect(() => {
    if (telemetry?.mode) setFlightMode(telemetry.mode);
  }, [telemetry?.mode]);

  const reconnect = async () => { await connect(); };
  const clearAndExit = () => { localStorage.removeItem(STORAGE_KEY); navigate('/', { replace: true }); };

  const changeVehicleMode = async (m: Exclude<VehicleMode, null>) => {
    setModeBusy(true);
    try {
      const r = await setVehicleModeRemote(m);
      if (r.ok) setVehicleModeLocal(m);
    } finally {
      setModeBusy(false);
    }
  };

  // --- PANELS (Same as before) ---
  const panelVehicle = (
    <VehicleModePanel
      vehicleMode={vehicleMode}
      modeBusy={modeBusy}
      onChangeMode={changeVehicleMode}
      onLock={async (ms?: number) => { await lock(ms); }}
      onUnlock={async () => { await unlock(); }}
    />
  );

  const panelAttitude = (
    <AttitudePanel
      connected={connected}
      flightMode={flightMode}
      onSetFlightMode={async (c: string) => await setAutopilotFlightMode(c)}
      onArm={arm}
      onDisarm={disarm}
      onTakeoff={async (alt?: number) => { await takeoff(alt); }}
      onLand={land}
      onFcuReboot={async () => { await fcuReboot(); }}
      onPreflightLevel={async () => { await preflightLevel(); }}
      onPreflightGyro={async () => { await preflightGyro(); }}
      onPreflightAccel={async () => { await preflightAccel(); }}
      yaw={telemetry?.attitude?.yaw_deg ?? 0}
      pitch={telemetry?.attitude?.pitch_deg ?? 0}
      roll={telemetry?.attitude?.roll_deg ?? 0}
      altitude={telemetry?.position?.rel_alt_m ?? telemetry?.position?.alt_m ?? 0}
      groundspeed={telemetry?.vel?.groundspeed_ms ?? 0}
      gpsSats={telemetry?.gps_sats ?? null}
      batteryPct={telemetry?.battery_pct ?? null}
    />
  );

  const panelMission = (
    <MissionPlannerPanel
      connected={connected}
      onDownload={missionDownload}
      onUpload={missionUpload}
      onClearVehicle={missionClear}
      onSetAuto={missionAuto}
      onStart={missionStart}
      centerLat={telemetry?.position?.lat ?? undefined}
      centerLon={telemetry?.position?.lon ?? undefined}
    />
  );

  const panelCommands = (
    <CommandsPanel modeBusy={modeBusy} error={error} drive={drive} stop={stop} />
  );

  const panelCamera = (
    <LiveCameraPanel
      baseUrl={client?.baseUrl}
      start={startCamera} stop={stopCamera} status={cameraStatus}
      recordStart={recordStart} recordStop={recordStop} recordStatus={recordStatus}
      startTof={startTofCamera} stopTof={stopTofCamera} statusTof={tofCameraStatus}
      recordStartTof={tofRecordStart} recordStopTof={tofRecordStop} recordStatusTof={tofRecordStatus}
      startThermal={startThermal} stopThermal={stopThermal} statusThermal={thermalStatus}
      recordStartThermal={thermalRecordStart} recordStopThermal={thermalRecordStop} recordStatusThermal={thermalRecordStatus}
      cameraFeedUrl={client?.cameraFeedUrl} cameraFrameUrl={client?.cameraFrameUrl}
      tofCameraFeedUrl={client?.tofCameraFeedUrl} tofCameraFrameUrl={client?.tofCameraFrameUrl}
      thermalFeedUrl={client?.thermalFeedUrl} thermalFrameUrl={client?.thermalFrameUrl}    
    />
  );

  if (!ip) return null;

  return (
    // 3. LOGIC: If Mobile, header height is 0 so it disappears
    <AppShell header={{ height: isMobile ? 0 : 70 }} padding="md">
      
      {/* 4. LOGIC: Only render the Header component if NOT mobile */}
      {!isMobile && (
        <AppShell.Header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingInline: rem(16),
            background: 'linear-gradient(135deg, #111 0%, #000 60%)',
            borderBottom: '2px solid #ffd04a',
          }}
        >
          <Title order={2} style={{ color: '#ffd04a', textShadow: '0 0 12px rgba(255,208,74,0.55)' }}>
            Mercurius Tech Command Center
          </Title>

          <Group gap="md">
            <Badge color={connected ? 'green' : 'red'} variant="filled">
              {connected ? 'Connected' : 'Disconnected'}
            </Badge>
            
            <Badge variant="outline" color="gray">
              {vehicleMode ? (vehicleMode === 'car' ? 'Car' : 'Air') : 'N/A'}
            </Badge>
            
            <Text c="white" fw={600}>API: {ip}</Text>
            
            <ActionIcon variant="white" onClick={reconnect} title="Reconnect">
              <IconRefresh />
            </ActionIcon>
            <ActionIcon variant="white" onClick={clearAndExit} title="Change robot">
              <IconLogout />
            </ActionIcon>
          </Group>
        </AppShell.Header>
      )}

      {/* 5. LOGIC: Floating Button & Drawer for Mobile */}
      {isMobile && (
        <>
          <Affix position={{ top: rem(15), right: rem(15) }} zIndex={200}>
            <ActionIcon 
              size="xl" 
              radius="xl" 
              color="dark" 
              variant="filled" 
              onClick={openDrawer}
              style={{ border: '1px solid #ffd04a', boxShadow: '0 2px 10px rgba(0,0,0,0.5)' }}
            >
              <IconMenu2 />
            </ActionIcon>
          </Affix>

          <Drawer 
            opened={drawerOpened} 
            onClose={closeDrawer} 
            title="System Menu" 
            position="right"
            padding="md"
            size="75%"
            zIndex={1000}
          >
            <Stack gap="md">
              <Group justify="space-between">
                <Text fw={500}>Status</Text>
                <Badge color={connected ? 'green' : 'red'} variant="filled">
                  {connected ? 'Connected' : 'Disconnected'}
                </Badge>
              </Group>

              <Group justify="space-between">
                <Text fw={500}>Mode</Text>
                <Badge variant="outline" color="gray">
                  {vehicleMode ? (vehicleMode === 'car' ? 'Car' : 'Air') : 'N/A'}
                </Badge>
              </Group>
              
              <Text size="sm" c="dimmed">API: {ip}</Text>

              <Button 
                fullWidth 
                variant="light" 
                color="gray" 
                leftSection={<IconRefresh size={20}/>} 
                onClick={() => { reconnect(); closeDrawer(); }}
              >
                Reconnect
              </Button>

              <Button 
                fullWidth 
                variant="light" 
                color="red" 
                leftSection={<IconLogout size={20}/>} 
                onClick={clearAndExit}
              >
                Change Robot
              </Button>
            </Stack>
          </Drawer>
        </>
      )}

      <AppShell.Main>
        {/* Remove padding on mobile to let video/map hit edges */}
        <Container fluid p={isMobile ? 0 : 'md'}>
          {isMobile ? (
            <Tabs defaultValue="mode" variant="pills" keepMounted={false}>
              <Tabs.List grow style={{ marginBottom: rem(15), overflowX: 'auto', flexWrap: 'nowrap' }}>
                <Tabs.Tab value="mode" leftSection={<IconDashboard size={16} />}>Mode</Tabs.Tab>
                <Tabs.Tab value="attitude" leftSection={<IconDrone size={16} />}>Attitude</Tabs.Tab>
                <Tabs.Tab value="mission" leftSection={<IconMap size={16} />}>Map</Tabs.Tab>
                <Tabs.Tab value="commands" leftSection={<IconTerminal size={16} />}>Cmds</Tabs.Tab>
                <Tabs.Tab value="camera" leftSection={<IconVideo size={16} />}>Cam</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel value="mode">{panelVehicle}</Tabs.Panel>
              <Tabs.Panel value="attitude">{panelAttitude}</Tabs.Panel>
              <Tabs.Panel value="mission">{panelMission}</Tabs.Panel>
              <Tabs.Panel value="commands">{panelCommands}</Tabs.Panel>
              <Tabs.Panel value="camera">{panelCamera}</Tabs.Panel>
            </Tabs>
          ) : (
            <Grid gutter="md">
              <Grid.Col span={{ base: 12 }}>{panelVehicle}</Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>{panelAttitude}</Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>{panelMission}</Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>{panelCommands}</Grid.Col>
              <Grid.Col span={{ base: 12, md: 6 }}>{panelCamera}</Grid.Col>
            </Grid>
          )}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}

export default TeleopPage;