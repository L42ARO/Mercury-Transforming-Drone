// src/components/MissionPlannerPanel.tsx
import { useEffect, useMemo, useState } from 'react';
import { 
  Badge, Button, Card, Group, NumberInput, Paper, Stack, Text, 
  TextInput, ActionIcon, Tooltip, Collapse, SimpleGrid, rem 
} from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { 
  IconX, IconSettings2, IconChevronDown, IconChevronUp,
  IconUpload, IconDownload, IconTrash, IconRobot, IconPlayerPlay, IconMapOff, IconTool 
} from '@tabler/icons-react';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, useMapEvents } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

import { Panel } from './Panel';

export type Waypoint = {
  lat: number; lon: number; alt: number;
  hold_s?: number; accept_radius_m?: number; pass_radius_m?: number;
  yaw_deg?: number;           
  autocontinue?: number;      
};

type Props = {
  connected: boolean;
  onDownload: () => Promise<{ ok: boolean; count: number; items: any[] }>;
  onUpload:   (waypoints: Waypoint[]) => Promise<{ ok: boolean }>;
  onClearVehicle: () => Promise<{ ok: boolean }>;
  onSetAuto:  () => Promise<{ ok: boolean }>;
  onStart:    () => Promise<{ ok: boolean }>;
  centerLat?: number;
  centerLon?: number;
};

// ... (Helper components: ClickToAdd, LocateOnLoad, etc. remain the same) ...
function ClickToAdd({ onAdd }: { onAdd: (lat: number, lon: number) => void }) {
  useMapEvents({ click(e) { onAdd(e.latlng.lat, e.latlng.lng); } });
  return null;
}
const dotIcon = L.divIcon({ className: 'wp-dot-icon', html: '', iconSize: [12, 12], iconAnchor: [6, 6] });
function LocateOnLoad({ onLocated, auto = true }: { onLocated: (lat: number, lon: number, accuracy: number) => void; auto?: boolean; }) {
  const map = useMap();
  useMapEvents({ locationfound(e) { onLocated(e.latlng.lat, e.latlng.lng, e.accuracy ?? 0); }, locationerror() {} });
  useEffect(() => { if (auto) map.locate({ setView: true, maxZoom: 18, enableHighAccuracy: true, watch: false }); }, [auto, map]);
  return null;
}
function RecenterButton({ target }: { target?: LatLngExpression }) {
  const map = useMap();
  if (!target) return null;
  return <Button size="xs" variant="light" onClick={() => map.setView(target, Math.max(map.getZoom(), 16))}>Locate me</Button>;
}

export default function MissionPlannerPanel({
  connected, onDownload, onUpload, onClearVehicle, onSetAuto, onStart, centerLat, centerLon,
}: Props) {
  const isMobile = useMediaQuery('(max-width: 48em)'); 
  
  const center = useMemo<LatLngExpression>(() => [centerLat ?? 37.4276, centerLon ?? -122.1697], [centerLat, centerLon]);

  const [wps, setWps] = useState<Waypoint[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(true);
  
  // Toggle for the new Collapsible Control Panel
  const [controlsOpen, setControlsOpen] = useState(false); 

  // User location
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLon, setUserLon] = useState<number | null>(null);
  const [userAcc, setUserAcc] = useState<number>(0);
  const userPos = useMemo<LatLngExpression | undefined>(() => (userLat != null && userLon != null ? [userLat, userLon] : undefined), [userLat, userLon]);

  // ... (Data handlers: addWp, updateWp, etc. unchanged) ...
  const addWp = (lat: number, lon: number) => {
    setWps(prev => [...prev, { lat, lon, alt: 20, hold_s: 0, accept_radius_m: 2, pass_radius_m: 0, yaw_deg: Number.NaN, autocontinue: 1 }]);
    setSelected(wps.length); setShowEditor(true);     
  };
  const updateWp = (idx: number, patch: Partial<Waypoint>) => setWps(prev => prev.map((w, i) => (i === idx ? { ...w, ...patch } : w)));
  const removeWp = (idx: number) => { setWps(prev => prev.filter((_, i) => i !== idx)); setSelected(s => (s === idx ? null : (s && s > idx ? s - 1 : s))); };
  const clearLocal = () => { setWps([]); setSelected(null); };

  // ... (API Wrappers unchanged) ...
  const upload = async () => {
    setBusy(true); setStatus(null);
    try {
      const payload = wps.map(({ yaw_deg, ...rest }) => ({ ...rest, hold_s: Number(rest.hold_s??0), accept_radius_m: Number(rest.accept_radius_m??2), pass_radius_m: Number(rest.pass_radius_m??0), autocontinue: Number(rest.autocontinue??1), ...(Number.isFinite(yaw_deg??Number.NaN) ? { yaw_deg: Number(yaw_deg) } : {}) }));
      const res = await onUpload(payload); setStatus(res.ok ? `Uploaded ${wps.length} WPs` : 'Upload failed');
    } catch (e:any) { setStatus(`Error: ${e.message}`); } finally { setBusy(false); }
  };
  const download = async () => {
    setBusy(true); setStatus(null);
    try {
      const res = await onDownload();
      if (res.ok) {
        const items = (res.items || []).map((it:any) => ({ lat: Number(it.lat), lon: Number(it.lon), alt: Number(it.alt), hold_s: Number(it.hold_s??0), accept_radius_m: Number(it.accept_radius_m??2), pass_radius_m: Number(it.pass_radius_m??0), yaw_deg: Number.isFinite(Number(it.yaw_deg))?Number(it.yaw_deg):Number.NaN, autocontinue: Number(it.autocontinue??1) }));
        setWps(items); setSelected(null); setStatus(`Downloaded ${items.length} WPs`);
      } else setStatus('Download failed');
    } catch (e:any) { setStatus(`Error: ${e.message}`); } finally { setBusy(false); }
  };
  const clearVehicle = async () => { setBusy(true); try { const r = await onClearVehicle(); setStatus(r.ok ? 'Cleared Vehicle' : 'Fail'); } catch (e:any) { setStatus(e.message); } finally { setBusy(false); } };
  const setAuto = async () => { setBusy(true); try { const r = await onSetAuto(); setStatus(r.ok ? 'Set AUTO' : 'Fail'); } catch (e:any) { setStatus(e.message); } finally { setBusy(false); } };
  const startMission = async () => { setBusy(true); try { const r = await onStart(); setStatus(r.ok ? 'Started Mission' : 'Fail'); } catch (e:any) { setStatus(e.message); } finally { setBusy(false); } };

  return (
    <Panel title="Mission Planner" right={<Badge color={connected ? 'green' : 'red'}>{connected ? 'Connected' : 'Disconnected'}</Badge>}>
      <style>{`.wp-dot-icon { background: #ffd04a; border-radius: 50%; box-shadow: 0 0 8px rgba(255,208,74,0.7); border: 1px solid #805f00; } .wp-user-icon { background: #4aa3ff; border-radius: 50%; box-shadow: 0 0 10px rgba(74,163,255,0.75); border: 1px solid #1b4c80; }`}</style>

      <Card radius="md" style={{ position: 'relative', height: 'min(70vh, calc(100vh - 220px))', minHeight: 460, background: '#0b0b0b', border: '1px solid #2a2a2a', overflow: 'hidden' }}>
        
        <MapContainer center={center} zoom={17} style={{ position: 'absolute', inset: 0 }}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OSM" />
          <LocateOnLoad onLocated={(lat, lon, acc) => { setUserLat(lat); setUserLon(lon); setUserAcc(acc); }} />
          <ClickToAdd onAdd={addWp} />
          {userPos && <><Marker position={userPos} icon={L.divIcon({ className: 'wp-user-icon', html: '', iconSize: [12,12], iconAnchor: [6,6] })} />{Number.isFinite(userAcc) && userAcc>0 && <Circle center={userPos} radius={userAcc} pathOptions={{opacity:0.35,weight:1}} />}</>}
          {wps.map((w, i) => <Marker key={i} position={[w.lat, w.lon]} icon={dotIcon} eventHandlers={{ click: () => { setSelected(i); setShowEditor(true); } }} />)}
          {wps.length >= 2 && <Polyline positions={wps.map(w => [w.lat, w.lon] as [number, number])} />}
          
          <div style={{ position: 'absolute', left: 12, bottom: isMobile && showEditor ? '55%' : 12, zIndex: 900, transition: 'bottom 0.3s ease' }}>
            <RecenterButton target={userPos} />
          </div>
        </MapContainer>

        {/* --- COLLAPSIBLE CONTROL PANEL (Top Left) --- */}
        <Paper
          shadow="md" radius="md" withBorder
          style={{
            position: 'absolute', left: 12, top: 12, zIndex: 1000,
            background: 'rgba(20,20,20,0.95)', backdropFilter: 'blur(4px)',
            width: controlsOpen ? (isMobile ? 'calc(100% - 24px)' : 300) : 'auto', // Expands width
            transition: 'width 0.2s ease'
          }}
        >
          {/* Header / Toggle Button */}
          <Group 
            justify="space-between" p="xs" 
            style={{ cursor: 'pointer' }} 
            onClick={() => setControlsOpen(o => !o)}
          >
            <Group gap={8}>
               <IconTool size={18} color="#ffd04a"/>
               <Text size="sm" fw={600}>Mission Controls</Text>
            </Group>
            {controlsOpen ? <IconChevronUp size={16} /> : <IconChevronDown size={16} />}
          </Group>

          {/* Collapsible Content */}
          <Collapse in={controlsOpen}>
             <Stack gap="xs" p="xs" pt={0}>
                {status && (
                  <Text size="xs" ta="center" c={status.includes('Fail')||status.includes('Error')?'red':'green'} fw={500}>
                    {status}
                  </Text>
                )}

                {/* Grid of Action Buttons with LABELS */}
                <SimpleGrid cols={2} spacing="xs">
                   <Button 
                      variant="light" size="xs" leftSection={<IconDownload size={14}/>} 
                      onClick={(e) => { e.stopPropagation(); download(); }} loading={busy}
                   >
                     Download
                   </Button>
                   <Button 
                      variant="light" size="xs" leftSection={<IconUpload size={14}/>} 
                      onClick={(e) => { e.stopPropagation(); upload(); }} disabled={wps.length===0} loading={busy}
                   >
                     Upload
                   </Button>
                   <Button 
                      variant="subtle" color="red" size="xs" leftSection={<IconTrash size={14}/>} 
                      onClick={(e) => { e.stopPropagation(); clearVehicle(); }} loading={busy}
                   >
                     Clear Robot
                   </Button>
                   <Button 
                      variant="subtle" color="orange" size="xs" leftSection={<IconMapOff size={14}/>} 
                      onClick={(e) => { e.stopPropagation(); clearLocal(); }}
                   >
                     Reset Map
                   </Button>
                </SimpleGrid>

                <Group grow mt="xs">
                   <Button 
                     color="blue" size="sm" leftSection={<IconRobot size={16}/>}
                     onClick={(e) => { e.stopPropagation(); setAuto(); }} loading={busy}
                   >
                     AUTO
                   </Button>
                   <Button 
                     color="green" size="sm" leftSection={<IconPlayerPlay size={16}/>}
                     onClick={(e) => { e.stopPropagation(); startMission(); }} loading={busy}
                   >
                     START
                   </Button>
                </Group>
             </Stack>
          </Collapse>
        </Paper>

        {/* --- Editor Toggle (Top Right) --- */}
        {!showEditor && (
          <Tooltip label="Open editor" withArrow>
            <ActionIcon variant="filled" color="yellow" size="lg" style={{ position: 'absolute', right: 12, top: 12, zIndex: 1000 }} onClick={() => setShowEditor(true)}>
              <IconSettings2 size={18} />
            </ActionIcon>
          </Tooltip>
        )}

        {/* --- Waypoint Editor (Bottom Sheet on Mobile) --- */}
        {showEditor && (
          <Paper
            shadow="xl" p="sm" withBorder
            style={{
              zIndex: 1000,
              background: 'rgba(20,20,20,0.95)', backdropFilter: 'blur(5px)',
              position: 'absolute',
              ...(isMobile ? { inset: 'auto 0 0 0', width: '100%', maxHeight: '50%', borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottom: 'none' } 
                           : { top: 12, right: 12, width: 320, maxHeight: 'calc(100% - 24px)', borderRadius: rem(8) }),
              overflowY: 'auto',
            }}
          >
            {/* Editor content unchanged */}
            <Group justify="space-between" mb="xs">
              <Text fw={600}>Waypoint Editor</Text>
              <ActionIcon variant="light" onClick={() => setShowEditor(false)}>
                 {isMobile ? <IconChevronDown size={16}/> : <IconX size={16} />}
              </ActionIcon>
            </Group>
            <Stack gap="xs">
              {selected == null || wps[selected] == null ? (
                <Text c="dimmed" size="sm">Click map to add waypoints. Select to edit.</Text>
              ) : (
                <>
                  <Group grow><TextInput label="Index" value={String(selected)} readOnly /><Button mt="lg" size="xs" variant="subtle" onClick={() => setSelected(null)}>Deselect</Button></Group>
                  <Group grow><TextInput label="Lat" value={String(wps[selected].lat)} onChange={(e)=>updateWp(selected, {lat:Number(e.currentTarget.value)})} /><TextInput label="Lon" value={String(wps[selected].lon)} onChange={(e)=>updateWp(selected, {lon:Number(e.currentTarget.value)})} /></Group>
                  <NumberInput label="Alt (m)" value={wps[selected].alt} onChange={(v)=>updateWp(selected, {alt:Number(v||0)})} />
                  <Group justify="space-between" mt="md">
                    <Button size="xs" variant="light" onClick={()=>setSelected(Math.max(0, (selected??0)-1))}>Prev</Button>
                    <Button size="xs" color="red" variant="outline" onClick={()=>removeWp(selected!)}>Delete</Button>
                    <Button size="xs" variant="light" onClick={()=>setSelected(Math.min(wps.length-1, (selected??0)+1))}>Next</Button>
                  </Group>
                </>
              )}
            </Stack>
          </Paper>
        )}
      </Card>
    </Panel>
  );
}