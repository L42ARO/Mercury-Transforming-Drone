// Mission Planner Modal logic
const mapDiv = document.getElementById('map');
const modal = document.getElementById('mission-modal');
const closeModal = document.getElementById('close-mission-modal');
const modalMap = document.getElementById('modal-map');
const waypointList = document.getElementById('waypoint-list');
const sendMissionBtn = document.getElementById('send-mission');
let waypoints = [];


if (mapDiv && modal && closeModal && modalMap && waypointList && sendMissionBtn) {
  mapDiv.addEventListener('click', () => {
    modal.style.display = 'flex';
    modal.style.alignItems = 'center';
    modal.style.justifyContent = 'center';
    renderWaypoints();
  });
  closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
    modal.style.alignItems = '';
    modal.style.justifyContent = '';
  });
  // Simulate a live map with click-to-add-waypoint
  modalMap.addEventListener('click', (e) => {
    const rect = modalMap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width).toFixed(3);
    const y = ((e.clientY - rect.top) / rect.height).toFixed(3);
    waypoints.push({lat: y, lon: x});
    renderWaypoints();
  });
  sendMissionBtn.addEventListener('click', () => {
    alert('Mission sent! (Simulated)\nWaypoints: ' + JSON.stringify(waypoints));
    waypoints = [];
    renderWaypoints();
    modal.style.display = 'none';
  });
}

function renderWaypoints() {
  if (!waypointList) return;
  if (waypoints.length === 0) {
    waypointList.innerHTML = '<em>No waypoints selected. Click the map to add.</em>';
  } else {
    waypointList.innerHTML = '<strong>Waypoints:</strong><br>' + waypoints.map((w,i) => `#${i+1}: Lat ${w.lat}, Lon ${w.lon}`).join('<br>');
  }
}
const logEl = document.getElementById("log");
function log(msg) {
  const time = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  line.textContent = `[${time}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}



// Mode switching logic
let mode = "car"; // 'air' or 'car' - default to ground mode
let flightMode = "Stabilize";
const modeLabel = document.getElementById("mode-label");
const modeToggle = document.getElementById("mode-toggle");

if (modeToggle) {
  modeToggle.addEventListener("click", () => {
    mode = (mode === "air") ? "car" : "air";
    updateModeUI();
  });
}

// Call this function to update the flight mode from your ArduPilot connection
window.setFlightMode = function(newMode) {
  flightMode = newMode;
  updateModeUI();
}

function updateModeUI() {
  if (modeLabel && modeToggle) {
    let modeText = `Mode: ${mode === "air" ? "Air" : "Car"} | Flight Mode: ${flightMode}`;
    modeLabel.textContent = modeText;
    modeToggle.textContent = mode === "air" ? "Switch to Car Mode" : "Switch to Air Mode";
  }
  
  // Show/hide appropriate command panels
  const airCommands = document.getElementById('air-commands');
  const groundCommands = document.getElementById('ground-commands');
  
  if (airCommands && groundCommands) {
    if (mode === "air") {
      airCommands.style.display = 'flex';
      groundCommands.style.display = 'none';
    } else {
      airCommands.style.display = 'none';
      groundCommands.style.display = 'block';
    }
  }
  
  // Update 3D scene based on mode
  if (typeof window.switchSceneMode === 'function') {
    window.switchSceneMode(mode);
  }
}

updateModeUI();

// Ground mode controls
let currentSpeed = 50;
let driveInterval = null;

// Speed slider handling
document.addEventListener('DOMContentLoaded', function() {
  const speedSlider = document.getElementById('speed-slider');
  const speedValue = document.getElementById('speed-value');
  
  if (speedSlider && speedValue) {
    speedSlider.addEventListener('input', function() {
      currentSpeed = this.value;
      speedValue.textContent = this.value + '%';
    });
  }
  
  // Ground control button handling
  document.querySelectorAll('[data-drive]').forEach(btn => {
    btn.addEventListener('mousedown', function() {
      const cmd = this.getAttribute('data-drive');
      startDriveCommand(cmd);
    });
    
    btn.addEventListener('mouseup', function() {
      stopDriveCommand();
    });
    
    btn.addEventListener('mouseleave', function() {
      stopDriveCommand();
    });
  });
  
  // Emergency stop
  const emergencyStop = document.getElementById('emergency-stop');
  if (emergencyStop) {
    emergencyStop.addEventListener('click', function() {
      sendDriveCommand('S');
      log('EMERGENCY STOP activated!');
    });
  }
});

// Drive command functions
function startDriveCommand(cmd) {
  if (cmd === 'S' || cmd === 'T') {
    // Stop and Test are single commands
    sendDriveCommand(cmd);
    return;
  }
  
  // For movement commands, send continuously while pressed
  sendDriveCommand(cmd);
  driveInterval = setInterval(() => {
    sendDriveCommand(cmd);
  }, 100); // Send command every 100ms while pressed
}

function stopDriveCommand() {
  if (driveInterval) {
    clearInterval(driveInterval);
    driveInterval = null;
  }
  // Send stop command when button released
  sendDriveCommand('S');
}

async function sendDriveCommand(cmd) {
  if (mode !== "car") {
    log('Cannot send drive commands in air mode');
    return;
  }
  
  try {
    const response = await fetch('/drive/cmd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cmd: cmd,
        speed: currentSpeed
      })
    });
    
    const result = await response.json();
    if (result.ok) {
      const cmdNames = {
        'F': 'Forward',
        'B': 'Reverse', 
        'L': 'Left',
        'R': 'Right',
        'S': 'Stop',
        'T': 'Test'
      };
      log(`Drive: ${cmdNames[cmd] || cmd} (${currentSpeed}%)`);
    } else {
      log(`Drive error: ${result.err}`);
    }
  } catch (error) {
    log(`Drive command failed: ${error.message}`);
  }
}

// Real attitude data will be updated from Flask backend via index.html

// Air mode command button clicks
document.querySelectorAll("[data-cmd]").forEach(btn => {
  btn.addEventListener("click", () => {
    const cmd = btn.dataset.cmd;
    log(`Command sent: ${cmd}`);
  });
});
