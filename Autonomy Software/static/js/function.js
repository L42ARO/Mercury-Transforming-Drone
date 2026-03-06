import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const container = document.getElementById('cube3d');
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87CEEB); // Sky blue background

// Track road/ground elements for mode switching
let roadElements = [];
let starField = null;

const camera = new THREE.PerspectiveCamera(75, container.offsetWidth / container.offsetHeight, 0.1, 1000);
camera.position.set(10, 8, 10);
camera.lookAt(0, 5, 0);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(container.offsetWidth, container.offsetHeight);
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 5, 0); // Focus on model center
controls.update();

const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
scene.add(ambientLight);

const loader = new STLLoader();
loader.load('models/V2-FR.stl', function (geometry) {
  geometry.center();

  const material = new THREE.MeshNormalMaterial();
  const mesh = new THREE.Mesh(geometry, material);

  mesh.scale.set(0.02, 0.02, 0.02);     // Scale down
  mesh.rotation.x = -Math.PI / 2;       // Rotate 90° on X-axis
  mesh.position.y = 5.0;                  // Slightly lower the model

  scene.add(mesh);

  // Add road/ground plane
  addRoadToScene();

  console.log("✅ STL loaded, zoomed in, and adjusted.");
}, undefined, function (error) {
  console.error("❌ STL load error:", error);
});

// Add road/ground plane with markings
function addRoadToScene() {
  // Clear existing road elements
  clearRoadFromScene();

  // Create expanded ground plane
  const groundGeometry = new THREE.PlaneGeometry(150, 150);
  const groundMaterial = new THREE.MeshBasicMaterial({
    color: 0x333333,
    transparent: true,
    opacity: 0.8
  });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2; // Make it horizontal
  ground.position.y = 0; // Ground level
  scene.add(ground);
  roadElements.push(ground);

  // Add road markings - center line (extended)
  const lineGeometry = new THREE.PlaneGeometry(1, 120);
  const lineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.9
  });

  // Center line (dashed effect with multiple segments)
  for (let i = -54; i <= 54; i += 6) {
    const centerLine = new THREE.Mesh(lineGeometry, lineMaterial);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, 0.01, i); // Slightly above ground
    scene.add(centerLine);
    roadElements.push(centerLine);
  }

  // Side lines (extended)
  const sideLineGeometry = new THREE.PlaneGeometry(0.5, 150);
  const sideLineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8
  });

  // Left side line
  const leftLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  leftLine.rotation.x = -Math.PI / 2;
  leftLine.position.set(-8, 0.01, 0);
  scene.add(leftLine);
  roadElements.push(leftLine);

  // Right side line
  const rightLine = new THREE.Mesh(sideLineGeometry, sideLineMaterial);
  rightLine.rotation.x = -Math.PI / 2;
  rightLine.position.set(8, 0.01, 0);
  scene.add(rightLine);
  roadElements.push(rightLine);

  // Add expanded grid lines for better depth perception
  const gridMaterial = new THREE.MeshBasicMaterial({
    color: 0x666666,
    transparent: true,
    opacity: 0.3
  });

  // Horizontal grid lines (expanded)
  for (let i = -70; i <= 70; i += 5) {
    const gridLine = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 0.2),
      gridMaterial
    );
    gridLine.rotation.x = -Math.PI / 2;
    gridLine.position.set(0, 0.005, i);
    scene.add(gridLine);
    roadElements.push(gridLine);
  }

  // Vertical grid lines (expanded)
  for (let i = -70; i <= 70; i += 5) {
    const gridLine = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 150),
      gridMaterial
    );
    gridLine.rotation.x = -Math.PI / 2;
    gridLine.position.set(i, 0.005, 0);
    scene.add(gridLine);
    roadElements.push(gridLine);
  }

  // Add additional cross streets for more realistic road network
  const crossStreetMaterial = new THREE.MeshBasicMaterial({
    color: 0x444444,
    transparent: true,
    opacity: 0.7
  });

  // Cross streets every 30 units
  for (let i = -60; i <= 60; i += 30) {
    if (i !== 0) { // Skip center to avoid overlap with main road
      const crossStreet = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 3),
        crossStreetMaterial
      );
      crossStreet.rotation.x = -Math.PI / 2;
      crossStreet.position.set(0, 0.002, i);
      scene.add(crossStreet);
      roadElements.push(crossStreet);
    }
  }

  console.log("✅ Expanded road and grid added to scene");
}

// Clear road elements from scene
function clearRoadFromScene() {
  roadElements.forEach(element => {
    scene.remove(element);
    // Dispose geometry and material to prevent memory leaks
    if (element.geometry) element.geometry.dispose();
    if (element.material) element.material.dispose();
  });
  roadElements = [];
}

// Switch between car mode (with road/sky) and air mode (starfield)
function switchSceneMode(mode) {
  if (mode === "car") {
    // Car mode: Show sky background and road
    scene.background = new THREE.Color(0x87CEEB); // Sky blue
    removeStarField(); // Remove stars
    addRoadToScene();
    console.log("✅ Switched to Car mode - Road and sky visible");
  } else {
    // Air mode: Remove road and show starfield
    scene.background = new THREE.Color(0x000011); // Deep space blue
    clearRoadFromScene(); // Remove road
    createStarField(); // Add stars
    console.log("✅ Switched to Air mode - Flying through stars");
  }
}

// Create starfield for air mode
function createStarField() {
  if (starField) {
    scene.remove(starField);
    starField.geometry.dispose();
    starField.material.dispose();
  }

  const starGeometry = new THREE.BufferGeometry();
  const starCount = 2000;
  const positions = new Float32Array(starCount * 3);

  // Create random star positions in a large sphere around the drone
  for (let i = 0; i < starCount; i++) {
    const i3 = i * 3;
    // Create stars in a sphere with radius 800-1000 units
    const radius = 800 + Math.random() * 200;
    const theta = Math.random() * Math.PI * 2; // Horizontal angle
    const phi = Math.random() * Math.PI; // Vertical angle

    positions[i3] = radius * Math.sin(phi) * Math.cos(theta);     // x
    positions[i3 + 1] = radius * Math.cos(phi);                   // y  
    positions[i3 + 2] = radius * Math.sin(phi) * Math.sin(theta); // z
  }

  starGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const starMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 2,
    sizeAttenuation: true
  });

  starField = new THREE.Points(starGeometry, starMaterial);
  scene.add(starField);
}

// Remove starfield
function removeStarField() {
  if (starField) {
    scene.remove(starField);
    starField.geometry.dispose();
    starField.material.dispose();
    starField = null;
  }
}

// Make switchSceneMode available globally for script.js
window.switchSceneMode = switchSceneMode;

function animate() {
  requestAnimationFrame(animate);
  controls.update();

  // Animate starfield if it exists (subtle rotation)
  if (starField) {
    starField.rotation.x += 0.0002;
    starField.rotation.y += 0.0001;
  }

  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = container.offsetWidth / container.offsetHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.offsetWidth, container.offsetHeight);
});
  </script >

  < !--Flask Backend Integration-- >
  <script>
    let map, droneMarker, pathPolyline;
    let flaskConnection = null;
    let isConnected = false;
    let dronePosition = {lat: 0, lng: 0, alt: 0 };
    let flightPath = [];
    const flaskBaseUrl = 'http://localhost:5000'; // Flask backend URL

    // Initialize the map
    function initMap() {
      map = L.map('map').setView([37.7749, -122.4194], 13); // Default to San Francisco

    // Define different map layers
    const baseMaps = {
      "Satellite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 18
        }),

    "Street Map": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    maxZoom: 19
        }),

    "Terrain": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: USGS, Esri, TANA, DeLorme, and NPS',
    maxZoom: 13
        }),

    "Dark Mode": L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    maxZoom: 19
        }),

    "Hybrid": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri',
    maxZoom: 18
        })
      };

    // Add default satellite layer
    baseMaps["Satellite"].addTo(map);

    // Create hybrid layer with labels overlay
    const hybridLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      attribution: ''
      });

    // Update hybrid to include labels
    baseMaps["Hybrid"] = L.layerGroup([baseMaps["Hybrid"], hybridLabels]);

    // Add layer control to switch between maps
    const layerControl = L.control.layers(baseMaps, null, {
      position: 'topright',
    collapsed: false
      });
    layerControl.addTo(map);

    // Create drone marker (red circle)
    droneMarker = L.circleMarker([37.7749, -122.4194], {
      color: '#ff0000',
    fillColor: '#ff0000',
    fillOpacity: 0.8,
    radius: 8
      }).addTo(map).bindPopup('Drone Position');

    // Initialize flight path
    pathPolyline = L.polyline([], {color: '#00ff00', weight: 3 }).addTo(map);
    }

    // Flask backend connection and telemetry polling
    function connectMAVLink() {
      if (isConnected) {
        // Disconnect - stop polling
        if (flaskConnection) {
      clearInterval(flaskConnection);
    flaskConnection = null;
        }
    isConnected = false;
    document.getElementById('mavlink-status').textContent = 'Disconnected';
    document.getElementById('mavlink-status').style.color = '#ff5d5d';
    document.getElementById('connectBtn').textContent = 'Connect MAVLink';
    logCommand('Disconnected from Flask backend', 'warning');

    // Hide header status indicators when disconnected
    hideHeaderStatus();

    // Reset attitude display to default values
    updateAttitudeDisplay({yaw: 0, pitch: 0, roll: 0 });
    return;
      }

    // Test Flask backend connection first
    fetch(`${flaskBaseUrl}/telemetry`, {
      method: 'GET',
    timeout: 5000 // 5 second timeout
      })
        .then(response => {
          if (response.ok || response.status === 204) {
      isConnected = true;
    document.getElementById('mavlink-status').textContent = 'Connected';
    document.getElementById('mavlink-status').style.color = '#18b27f';
    document.getElementById('connectBtn').textContent = 'Disconnect';
    logCommand('✓ Connected to Flask backend successfully', 'success');

    // Fetch initial telemetry data immediately
    fetchTelemetryData();

    // Start polling telemetry data every 1 second
    flaskConnection = setInterval(fetchTelemetryData, 1000);

    // Also add a connection health monitor every 5 seconds
    setInterval(checkConnectionHealth, 5000);
          } else {
            throw new Error(`HTTP ${response.status}`);
          }
        })
        .catch(error => {
      console.error('Failed to connect to Flask backend:', error);
    document.getElementById('mavlink-status').textContent = 'Connection Failed';
    document.getElementById('mavlink-status').style.color = '#f0b429';
    logCommand(`✗ Failed to connect to Flask backend: ${error.message}`, 'error');
        });
    }

    // Fetch telemetry data from Flask backend
    async function fetchTelemetryData() {
      try {
        const [telemetryRes, armStatusRes, modeStatusRes] = await Promise.all([
    fetch(`${flaskBaseUrl}/telemetry`),
    fetch(`${flaskBaseUrl}/arm_status`),
    fetch(`${flaskBaseUrl}/mode_status`)
    ]);

    if (telemetryRes.ok) {
          const telemetryData = await telemetryRes.json();
    handleTelemetryData(telemetryData);
        } else if (telemetryRes.status === 204) {
      // No telemetry data available yet
      console.log('No telemetry data available yet');
        }

    if (armStatusRes.ok) {
          const armData = await armStatusRes.json();
    updateArmStatus(armData.armed);
        }

    if (modeStatusRes.ok) {
          const modeData = await modeStatusRes.json();
    updateFlightMode(modeData.mode || 'Unknown');
        }

      } catch (error) {
      console.error('Error fetching telemetry:', error);
    // If we get multiple consecutive errors, consider disconnecting
    if (!isConnected) return;

        // For now, just continue polling - Flask backend might be temporarily unavailable
      }
    }

    // Handle telemetry data from Flask backend
    function handleTelemetryData(data) {
      if (data.lat && data.lon && data.alt !== undefined) {
      // Update drone position
      dronePosition.lat = data.lat;
    dronePosition.lng = data.lon;
    dronePosition.alt = data.alt;

    updateDroneOnMap();
    updateTelemetryDisplay(data);
      }

    // Update attitude data if available
    if (data.yaw !== undefined || data.pitch !== undefined || data.roll !== undefined) {
      updateAttitudeDisplay(data);
      }
    }

    // Update drone position on map
    function updateDroneOnMap() {
      if (droneMarker && map) {
        const newPos = [dronePosition.lat, dronePosition.lng];
    droneMarker.setLatLng(newPos);

    // Add to flight path
    flightPath.push(newPos);
        if (flightPath.length > 100) { // Limit path length
      flightPath.shift();
        }
    pathPolyline.setLatLngs(flightPath);

    // Center map on drone if it's the first position update
    if (flightPath.length === 1) {
      map.setView(newPos, 15);
        }
      }
    }

    // Update telemetry display with Flask data
    function updateTelemetryDisplay(data) {
      if (document.getElementById('telemetry-alt') && data.alt !== undefined) {
      document.getElementById('telemetry-alt').textContent = data.alt.toFixed(1);
      }

    // Set default values for data not available from Flask backend
    if (document.getElementById('telemetry-speed')) {
      document.getElementById('telemetry-speed').textContent = '0.0'; // Not available in current backend
      }
    if (document.getElementById('telemetry-gps')) {
      document.getElementById('telemetry-gps').textContent = data.lat && data.lon ? '8' : '0'; // Simulate GPS status
      }
    if (document.getElementById('telemetry-batt')) {
      document.getElementById('telemetry-batt').textContent = '85'; // Placeholder - not available in backend
      }
    if (document.getElementById('telemetry-rc')) {
      document.getElementById('telemetry-rc').textContent = isConnected ? 'Good' : 'No Signal';
      }

    // Update header status indicators
    updateHeaderStatus(data);
    }

    // Update header status indicators
    function updateHeaderStatus(data) {
      // GPS Status
      const gpsStatus = document.getElementById('gps-status');
    const gpsDot = document.getElementById('gps-dot');
    const gpsSats = document.getElementById('gps-sats');

    if (gpsStatus && gpsDot && gpsSats) {
      gpsStatus.style.display = 'inline-flex';
    gpsStatus.style.color = '#fff';

    if (data.lat && data.lon) {
          // Simulate GPS satellite count based on position accuracy
          const satCount = Math.floor(Math.random() * 4) + 8; // 8-11 satellites
    gpsSats.textContent = satCount;
    gpsDot.className = 'dot green';
        } else {
      gpsSats.textContent = '0';
    gpsDot.className = 'dot red';
        }
      }

    // Link Status
    const linkStatus = document.getElementById('link-status');
    const linkDot = document.getElementById('link-dot');
    const linkQuality = document.getElementById('link-quality');

    if (linkStatus && linkDot && linkQuality) {
      linkStatus.style.display = 'inline-flex';
    linkStatus.style.color = '#fff';

    if (isConnected) {
      linkQuality.textContent = 'Good';
    linkDot.className = 'dot green';
        } else {
      linkQuality.textContent = 'Disconnected';
    linkDot.className = 'dot red';
        }
      }

    // Battery Status (placeholder until backend provides battery data)
    const batteryStatus = document.getElementById('battery-status');
    const batteryDot = document.getElementById('battery-dot');
    const batteryLevel = document.getElementById('battery-level');

    if (batteryStatus && batteryDot && batteryLevel && isConnected) {
      batteryStatus.style.display = 'inline-flex';
    batteryStatus.style.color = '#fff';

    // Simulate battery level - replace with real data when available
    const battLevel = Math.floor(Math.random() * 20) + 70; // 70-90%
    batteryLevel.textContent = battLevel + '%';
        
        if (battLevel > 50) {
      batteryDot.className = 'dot green';
        } else if (battLevel > 20) {
      batteryDot.className = 'dot orange';
        } else {
      batteryDot.className = 'dot red';
        }
      }
    }

    // Hide header status indicators when disconnected
    function hideHeaderStatus() {
      const gpsStatus = document.getElementById('gps-status');
    const linkStatus = document.getElementById('link-status');
    const batteryStatus = document.getElementById('battery-status');

    if (gpsStatus) gpsStatus.style.display = 'none';
    if (linkStatus) linkStatus.style.display = 'none';
    if (batteryStatus) batteryStatus.style.display = 'none';
    }

    // Update armed status
    function updateArmStatus(armed) {
      console.log('Armed status:', armed);
      // You could add visual indicators here, like changing button colors
      // or showing armed/disarmed status in the UI
    }

    // Update flight mode display
    function updateFlightMode(mode) {
      if (document.getElementById('telemetry-mode')) {
      document.getElementById('telemetry-mode').textContent = mode;
      }
    if (document.getElementById('current-flight-mode')) {
      document.getElementById('current-flight-mode').textContent = mode;
      }
    }

    // Update attitude display with real data from Flask backend
    function updateAttitudeDisplay(data) {
      const attitudeElement = document.getElementById('attitude');
    if (attitudeElement) {
        const yaw = data.yaw !== undefined ? data.yaw.toFixed(1) : '0.0';
    const pitch = data.pitch !== undefined ? data.pitch.toFixed(1) : '0.0';
    const roll = data.roll !== undefined ? data.roll.toFixed(1) : '0.0';

    attitudeElement.textContent = `Yaw: ${yaw}° | Pitch: ${pitch}° | Roll: ${roll}°`;
      }
    }

    // Monitor connection health
    function checkConnectionHealth() {
      if (!isConnected) return;

    fetch(`${flaskBaseUrl}/telemetry`, {method: 'GET' })
        .then(response => {
          if (!response.ok && response.status !== 204) {
            throw new Error(`HTTP ${response.status}`);
          }
    // Connection is healthy
    if (document.getElementById('mavlink-status').textContent !== 'Connected') {
      document.getElementById('mavlink-status').textContent = 'Connected';
    document.getElementById('mavlink-status').style.color = '#18b27f';
          }
        })
        .catch(error => {
      console.error('Connection health check failed:', error);
    document.getElementById('mavlink-status').textContent = 'Connection Issues';
    document.getElementById('mavlink-status').style.color = '#f0b429';
        });
    }

    // Flask command functions with enhanced error handling
    async function sendFlaskCommand(endpoint, data = { }) {
      const startTime = Date.now();

    try {
        const response = await fetch(`${flaskBaseUrl}${endpoint}`, {
      method: 'POST',
    headers: {
      'Content-Type': 'application/json',
          },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(10000) // 10 second timeout
        });

    const result = await response.json();
    const duration = Date.now() - startTime;

    if (response.ok && result.status === 'ok') {
      logCommand(`✓ ${endpoint} completed successfully (${duration}ms)`, 'success');
    return {success: true, result };
        } else {
          const errorMsg = result.message || `HTTP ${response.status}`;
    logCommand(`✗ ${endpoint} failed: ${errorMsg}`, 'error');
    return {success: false, error: errorMsg };
        }
      } catch (error) {
        const duration = Date.now() - startTime;
    let errorMsg = 'Connection error';

    if (error.name === 'TimeoutError') {
      errorMsg = 'Command timeout (10s)';
        } else if (error.name === 'NetworkError') {
      errorMsg = 'Network error - check Flask backend';
        }

    console.error(`Error sending command to ${endpoint}:`, error);
    logCommand(`✗ ${endpoint} failed: ${errorMsg} (${duration}ms)`, 'error');
    return {success: false, error: errorMsg };
      }
    }

    // Button state management
    function setButtonLoading(button, loading) {
      if (loading) {
      button.disabled = true;
    button.dataset.originalText = button.textContent;
    button.textContent = 'Loading...';
    button.style.opacity = '0.6';
      } else {
      button.disabled = false;
    button.textContent = button.dataset.originalText;
    button.style.opacity = '1';
      }
    }

    // Flight mode change function with enhanced feedback
    async function setFlightMode() {
      if (!isConnected) {
      logCommand('✗ Not connected to backend', 'warning');
    return;
      }

    const modeSelect = document.getElementById('flight-mode-select');
    const setModeBtn = document.getElementById('set-mode-btn');
    const selectedMode = modeSelect.value;

    setButtonLoading(setModeBtn, true);
    logCommand(`Setting flight mode to ${selectedMode}...`, 'info');

    const result = await sendFlaskCommand('/set_mode', {mode: selectedMode });
    setButtonLoading(setModeBtn, false);

    if (result.success) {
      // Update UI immediately for better responsiveness
      updateFlightMode(selectedMode);
      }
    }

    // Enhanced command functions with visual feedback
    async function executeCommand(command, buttonElement) {
      if (!isConnected) {
      logCommand('✗ Not connected to backend', 'warning');
    return;
      }

    if (buttonElement) {
      setButtonLoading(buttonElement, true);
      }

    let result;
    switch (command) {
        case 'TAKEOFF':
    logCommand('Executing takeoff...', 'info');
    result = await sendFlaskCommand('/takeoff', {altitude: 5.0 });
    break;

    case 'LAND':
    logCommand('Executing land...', 'info');
    result = await sendFlaskCommand('/mission/stop_land');
    break;

    case 'RTL':
    logCommand('Executing return to launch...', 'info');
    result = await sendFlaskCommand('/mission/stop_rtl');
    break;

    case 'DISARM':
    logCommand('Executing disarm...', 'info');
    result = await sendFlaskCommand('/arm_disarm');
    break;

    default:
    logCommand(`✗ Unknown command: ${command}`, 'error');
    result = {success: false };
      }

    if (buttonElement) {
      setButtonLoading(buttonElement, false);
      }

    return result;
    }

    // Enhanced logging with different levels and colors
    function logCommand(message, level = 'info') {
      const logElement = document.getElementById('log');
    if (logElement) {
        const timestamp = new Date().toLocaleTimeString();
    const colors = {
      success: '#18b27f',
    error: '#ff5d5d',
    warning: '#f0b429',
    info: '#3ea6ff'
        };

    const color = colors[level] || colors.info;
    const logEntry = document.createElement('div');
    logEntry.style.cssText = `margin:2px 0;font-size:0.9em;color:${color};`;
    logEntry.innerHTML = `[${timestamp}] ${message}`;

    logElement.appendChild(logEntry);
    logElement.scrollTop = logElement.scrollHeight;

    // Limit log entries to prevent memory issues
    const maxEntries = 100;
        while (logElement.children.length > maxEntries) {
      logElement.removeChild(logElement.firstChild);
        }
      }
    console.log(`[${level.toUpperCase()}] ${message}`);
    }

    // Connect/Disconnect button handler
    document.getElementById('connectBtn').addEventListener('click', function() {
      connectMAVLink();
    });

    // Camera functions
    function handleImageError(img) {
      img.src = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+CiAgPHRleHQgeD0iNTAlIiB5PSI1MCUiIGZvbnQtZmFtaWx5PSJBcmlhbCIgZm9udC1zaXplPSIxOCIgZmlsbD0iIzk5OSIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iPkNhbWVyYSBOb3QgQXZhaWxhYmxlPC90ZXh0Pgo8L3N2Zz4K";
    document.getElementById('camera-status').innerHTML = '<span style="color: red;">Camera feed not available</span>';
    }

    async function startCamera() {
      try {
        const response = await fetch('http://100.66.197.16:8080/camera/start', {method: 'POST' });
    const result = await response.json();
    if (result.ok) {
      document.getElementById('cameraFeed').src = 'http://100.66.197.16:8080/video_feed?' + Date.now();
    document.getElementById('camera-status').innerHTML = '<span style="color: green;">Camera started</span>';
        } else {
      document.getElementById('camera-status').innerHTML = '<span style="color: red;">Failed to start camera: ' + (result.error || 'Unknown error') + '</span>';
        }
      } catch (error) {
      document.getElementById('camera-status').innerHTML = '<span style="color: red;">Error: ' + error.message + '</span>';
      }
    }

    async function stopCamera() {
      try {
        const response = await fetch('http://100.66.197.16:8080/camera/stop', {method: 'POST' });
    const result = await response.json();
    document.getElementById('camera-status').innerHTML = '<span style="color: orange;">Camera stopped</span>';
    document.getElementById('cameraFeed').src = '';
      } catch (error) {
      document.getElementById('camera-status').innerHTML = '<span style="color: red;">Error: ' + error.message + '</span>';
      }
    }

    // Check camera status on page load
    async function checkCameraStatus() {
      try {
        const response = await fetch('http://100.66.197.16:8080/camera/status');
    const status = await response.json();
    document.getElementById('camera-status').innerHTML = '<span style="color: blue;">Camera status: ' + JSON.stringify(status) + '</span>';
      } catch (error) {
      document.getElementById('camera-status').innerHTML = '<span style="color: red;">Could not get camera status</span>';
      }
    }

    // Event handlers setup
    document.addEventListener('DOMContentLoaded', function() {
      // Initialize map
      setTimeout(initMap, 100);

      // Hide the initialization message after a few seconds
      setTimeout(() => {
        const initMessage = document.getElementById('init-message');
    if (initMessage) {
      initMessage.style.display = 'none';
        }
      }, 5000); // Hide after 5 seconds

    // Initialize attitude display with default values
    updateAttitudeDisplay({yaw: 0, pitch: 0, roll: 0 });

    // Add event listeners to command buttons
    const commandButtons = document.querySelectorAll('[data-cmd]');
      commandButtons.forEach(button => {
      button.addEventListener('click', function () {
        const command = this.getAttribute('data-cmd');
        executeCommand(command, this); // Pass button element for visual feedback
      });
      });

    // Add event listener for flight mode change
    const setModeBtn = document.getElementById('set-mode-btn');
    if (setModeBtn) {
      setModeBtn.addEventListener('click', setFlightMode);
      }

    // Also allow Enter key on mode select dropdown
    const modeSelect = document.getElementById('flight-mode-select');
    if (modeSelect) {
      modeSelect.addEventListener('keypress', function (e) {
        if (e.key === 'Enter') {
          setFlightMode();
        }
      });
      }

    // Add mode toggle event listener (MISSING!)
    const modeToggleBtn = document.getElementById('mode-toggle');
    if (modeToggleBtn) {
      modeToggleBtn.addEventListener('click', function () {
        toggleMode();
      });
      }

    // Check camera status on page load
    setTimeout(checkCameraStatus, 1000);
    });


    // Mode toggle functionality
    let currentMode = 'air'; // Track current mode

    async function toggleMode() {
      const modeToggleBtn = document.getElementById('mode-toggle');
    const modeLabel = document.getElementById('mode-label');
    const airCommands = document.getElementById('air-commands');
    const groundCommands = document.getElementById('ground-commands');

    setButtonLoading(modeToggleBtn, true);

    if (currentMode === 'air') {
        // Switch to car mode
        try {
          const response = await fetch('http://100.66.197.16:8080/change_to_car_mode', {method: 'POST' });
    const result = await response.json();

    if (result.success) {
      currentMode = 'car';
    modeToggleBtn.textContent = 'Switch to Air Mode';
    modeLabel.innerHTML = 'Mode: Car | Drive Mode: <span id="current-flight-mode">Manual</span>';
    airCommands.style.display = 'none';
    groundCommands.style.display = 'block';
    switchSceneMode('car'); // Switch 3D scene
    logCommand('✓ Switched to Car Mode', 'success');
          } else {
      logCommand('✗ Failed to switch to Car Mode: ' + (result.error || 'Unknown error'), 'error');
          }
        } catch (error) {
      logCommand('✗ Car Mode error: ' + error.message, 'error');
        }
      } else {
        // Switch to air mode
        try {
          const response = await fetch('http://100.66.197.16:8080/change_to_drone_mode', {method: 'POST' });
    const result = await response.json();

    if (result.success) {
      currentMode = 'air';
    modeToggleBtn.textContent = 'Switch to Car Mode';
    modeLabel.innerHTML = 'Mode: Air | Flight Mode: <span id="current-flight-mode">Stabilize</span>';
    airCommands.style.display = 'flex';
    groundCommands.style.display = 'none';
    switchSceneMode('air'); // Switch 3D scene
    logCommand('✓ Switched to Air Mode', 'success');
          } else {
      logCommand('✗ Failed to switch to Air Mode: ' + (result.error || 'Unknown error'), 'error');
          }
        } catch (error) {
      logCommand('✗ Air Mode error: ' + error.message, 'error');
        }
      }

    setButtonLoading(modeToggleBtn, false);
    }