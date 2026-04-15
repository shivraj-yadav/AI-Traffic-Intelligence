const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' })); // Larger limit for bbox arrays

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const LANES = ['north', 'east', 'south', 'west'];

// Global State
let systemState = {
  mode: 'AI', // 'AI' or 'STATIC'
  weather: 'Clear', // 'Clear' or 'Rain'
  emergency: false,
  lanes: {
    north: { vehicles: 0, signal: 'RED', time: 0, boxes: [], ambulanceBoxes: [] },
    east:  { vehicles: 0, signal: 'RED', time: 0, boxes: [], ambulanceBoxes: [] },
    south: { vehicles: 0, signal: 'RED', time: 0, boxes: [], ambulanceBoxes: [] },
    west:  { vehicles: 0, signal: 'RED', time: 0, boxes: [], ambulanceBoxes: [] }
  }
};

// Internal engine tracking
let engine = {
  activeLane: 'north',
  phase: 'GREEN', // 'GREEN' | 'YELLOW' | 'ALL_RED'
  timer: 30, // seconds remaining in current phase
  ambulanceHistory: { north: 0, east: 0, south: 0, west: 0 },
  ambulanceConfirmation: { north: 0, east: 0, south: 0, west: 0 },
  laneIdleTimer: { north: 0, east: 0, south: 0, west: 0 },
  ambulanceQueue: [],
  ambulanceActiveLane: null,
  ambulanceCapTimer: 0,
  pendingAmbulanceLane: null, // Lane waiting for GREEN after yellow transition
  prevVehicles: { north: 0, east: 0, south: 0, west: 0 },
  lastPingTime: Date.now()
};

// Raw detection data populated by Python script (now includes boxes)
let detections = {
  north: { vehicles: 0, ambulance: false, confidence: 0.0, boxes: [], ambulanceBoxes: [] },
  east:  { vehicles: 0, ambulance: false, confidence: 0.0, boxes: [], ambulanceBoxes: [] },
  south: { vehicles: 0, ambulance: false, confidence: 0.0, boxes: [], ambulanceBoxes: [] },
  west:  { vehicles: 0, ambulance: false, confidence: 0.0, boxes: [], ambulanceBoxes: [] },
  weather: 'Clear'
};

// Start logic loop (1 second tick)
setInterval(() => {
  // Sync weather from detections
  systemState.weather = detections.weather || 'Clear';

  if (systemState.mode === 'STATIC') {
    handleStaticMode();
  } else {
    handleAiMode();
  }

  // Map internal engine data to external state
  updateExternalState();

  io.emit('state_update', {
    north: systemState.lanes.north,
    east: systemState.lanes.east,
    south: systemState.lanes.south,
    west: systemState.lanes.west,
    weather: systemState.weather,
    mode: systemState.mode,
    emergency: systemState.emergency
  });
}, 1000);

function handleStaticMode() {
  // Graceful recovery from AI crash states
  if (engine.phase === 'ALL_RED') {
    engine.phase = 'GREEN';
    engine.timer = 30;
    engine.activeLane = 'north';
    return;
  }

  engine.timer--;

  if (engine.phase === 'GREEN' && engine.timer <= 3 && engine.timer > 0) {
    engine.phase = 'YELLOW';
  }

  if (engine.timer <= 0) {
    engine.activeLane = getNextLane(engine.activeLane);
    engine.phase = 'GREEN';
    engine.timer = 30;
  }
}

function handleAiMode() {
  // SENSOR FAILURE CHECK
  if (Date.now() - engine.lastPingTime > 10000) {
     console.log("Sensor failure detected (10s no ping). Switching to STATIC mode.");
     systemState.mode = 'STATIC';
     return handleStaticMode();
  }

  // UPDATE IDLE TIMERS
  for (let l of LANES) {
    if (engine.phase === 'GREEN' && engine.activeLane === l) {
      engine.laneIdleTimer[l] = 0;
    } else if (detections[l].vehicles > 0) {
      engine.laneIdleTimer[l]++;
    } else {
      engine.laneIdleTimer[l] = 0;
    }
  }

  // AI STEP 1: AMBULANCE PRIORITY (With 2-frame confirmation)
  let activeAmbulances = [];
  for (let l of LANES) {
    if (detections[l].ambulance) {
      engine.ambulanceConfirmation[l]++;
      if (engine.ambulanceConfirmation[l] >= 2) {
        activeAmbulances.push({ lane: l, conf: detections[l].confidence });
      }
      engine.ambulanceHistory[l] = 0;
    } else {
      engine.ambulanceHistory[l]++;
      engine.ambulanceConfirmation[l] = 0;
    }
  }

  // ─── HANDLE PENDING AMBULANCE (waiting for yellow to finish) ───
  if (engine.pendingAmbulanceLane) {
    engine.timer--;
    if (engine.timer <= 0) {
      // Yellow finished → switch to ambulance lane as GREEN
      engine.activeLane = engine.pendingAmbulanceLane;
      engine.ambulanceActiveLane = engine.pendingAmbulanceLane;
      engine.pendingAmbulanceLane = null;
      systemState.emergency = true;
      engine.phase = 'GREEN';
      engine.timer = 99;
      engine.ambulanceCapTimer = 0;
      console.log(`🚑 Ambulance GREEN activated for ${engine.activeLane}`);
    }
    return;
  }

  // ─── CHECK IF CURRENT EMERGENCY LANE LOST AMBULANCE ───
  if (systemState.emergency) {
    engine.ambulanceCapTimer++;
    if (engine.ambulanceHistory[engine.ambulanceActiveLane] >= 3 || engine.ambulanceCapTimer >= 60) {
      // Emergency over → go YELLOW 3s, then restart round-robin from ambulance lane
      systemState.emergency = false;
      // activeLane stays as ambulanceActiveLane so round-robin continues from here
      engine.activeLane = engine.ambulanceActiveLane;
      engine.ambulanceActiveLane = null;
      engine.ambulanceCapTimer = 0;
      engine.phase = 'YELLOW';
      engine.timer = 3;
      console.log(`🚑 Emergency ended. Yellow transition from ${engine.activeLane}, round-robin resumes after.`);
      return;
    } else {
      // Emergency still active — keep ambulance lane GREEN
      engine.phase = 'GREEN';
      engine.activeLane = engine.ambulanceActiveLane;
      engine.timer = 99;
      return; 
    }
  }

  // ─── NEW AMBULANCE DETECTED → trigger YELLOW transition first ───
  if (activeAmbulances.length > 0 && !systemState.emergency) {
    activeAmbulances.sort((a, b) => b.conf - a.conf);
    let targetAmbulance = activeAmbulances[0].lane;

    // If ambulance is already in the current green lane, just activate emergency directly
    if (targetAmbulance === engine.activeLane && engine.phase === 'GREEN') {
      systemState.emergency = true;
      engine.ambulanceActiveLane = targetAmbulance;
      engine.phase = 'GREEN';
      engine.timer = 99;
      engine.ambulanceCapTimer = 0;
      console.log(`🚑 Ambulance detected in current GREEN lane: ${targetAmbulance}`);
      return;
    }

    // Ambulance in a different lane → current lane goes YELLOW(3s) first
    engine.pendingAmbulanceLane = targetAmbulance;
    engine.phase = 'YELLOW';
    engine.timer = 3;
    console.log(`🚑 Ambulance detected in ${targetAmbulance}. Current lane ${engine.activeLane} → YELLOW (3s)`);
    return;
  }

  // ─── NORMAL AI MODE TICK ───
  engine.timer--;

  // Traffic Spike Adjustment
  if (engine.phase === 'GREEN') {
     let currentDiff = detections[engine.activeLane].vehicles - engine.prevVehicles[engine.activeLane];
     if (currentDiff >= 5 && engine.timer < 10) {
        engine.timer += 5;
        console.log(`Traffic Spike Detected in ${engine.activeLane}, adding 5 secs.`);
     }
  }

  if (engine.timer <= 0) {
    if (engine.phase === 'GREEN') {
      // GREEN → YELLOW (always 3 seconds)
      engine.phase = 'YELLOW';
      engine.timer = 3;
    } else if (engine.phase === 'YELLOW') {
      // YELLOW expired → pick next lane
      let nextLane = null;
      
      // Starvation Priority Override
      for (let l of LANES) {
          if (engine.laneIdleTimer[l] >= 30) {
              nextLane = l;
              engine.laneIdleTimer[l] = 0;
              console.log(`Lane Starvation Triggered: Forcing ${l} to GREEN`);
              break;
          }
      }
      
      if (!nextLane) {
          nextLane = getNextLane(engine.activeLane);
          let attempts = 0;
          
          while (detections[nextLane].vehicles === 0 && attempts < 4) {
            nextLane = getNextLane(nextLane);
            attempts++;
          }

          if (attempts === 4) {
            engine.phase = 'ALL_RED';
            engine.timer = 2;
            return;
          }
      }

      engine.activeLane = nextLane;
      engine.phase = 'GREEN';
      let baseTime = 15;
      if (systemState.weather === 'Rain') baseTime += 10;
      engine.timer = baseTime;
    } else if (engine.phase === 'ALL_RED') {
      let foundLane = LANES.find(l => detections[l].vehicles > 0);
      if (foundLane) {
        engine.activeLane = foundLane;
        engine.phase = 'GREEN';
        let baseTime = 15;
        if (systemState.weather === 'Rain') baseTime += 10;
        engine.timer = baseTime;
      } else {
        engine.timer = 2;
      }
    }
  }

  // Save previous state for spike detection
  for (let l of LANES) {
    engine.prevVehicles[l] = detections[l].vehicles;
  }
}

function getNextLane(current) {
  let idx = LANES.indexOf(current);
  return LANES[(idx + 1) % LANES.length];
}

function updateExternalState() {
  for (let l of LANES) {
    // Vehicle count is always sent for all lanes (even paused/RED ones)
    systemState.lanes[l].vehicles = systemState.mode === 'STATIC' ? 0 : detections[l].vehicles;
    
    // Bounding boxes: only for the ACTIVE lane (GREEN/YELLOW) in AI mode
    // Paused (RED) lanes show vehicle count but no overlay boxes
    const isActiveLane = (l === engine.activeLane) && (engine.phase === 'GREEN' || engine.phase === 'YELLOW');
    
    if (systemState.mode === 'AI' && isActiveLane) {
      systemState.lanes[l].boxes = detections[l].boxes || [];
      systemState.lanes[l].ambulanceBoxes = detections[l].ambulanceBoxes || [];
    } else {
      systemState.lanes[l].boxes = [];
      systemState.lanes[l].ambulanceBoxes = [];
    }

    if (engine.phase === 'ALL_RED') {
      systemState.lanes[l].signal = 'RED';
      systemState.lanes[l].time = 0;
      continue;
    }

    if (l === engine.activeLane) {
      systemState.lanes[l].signal = engine.phase;
      systemState.lanes[l].time = engine.timer;
    } else {
      systemState.lanes[l].signal = 'RED';
      systemState.lanes[l].time = 0;
    }
  }
}

// API Endpoints
app.get('/status', (req, res) => {
  res.json(systemState);
});

app.post('/mode', (req, res) => {
  const { mode } = req.body;
  if (['AI', 'STATIC'].includes(mode)) {
    systemState.mode = mode;

    systemState.emergency = false;
    engine.ambulanceActiveLane = null;
    engine.ambulanceCapTimer = 0;
    engine.pendingAmbulanceLane = null;

    if (engine.phase === 'ALL_RED') {
      engine.phase = 'GREEN';
      engine.timer = 30;
      engine.activeLane = 'north';
    }

    if (mode === 'STATIC' && engine.timer > 30) {
      engine.timer = 30;
    }

    res.json({ success: true, mode });
  } else {
    res.status(400).json({ error: 'Invalid mode' });
  }
});

// Endpoint for Python script to push detections (now with bbox data)
app.post('/detections', (req, res) => {
  const data = req.body;
  if (data) {
    if (data.timestamp) engine.lastPingTime = data.timestamp;
    
    for (let l of LANES) {
      if (data[l]) {
        detections[l].vehicles = data[l].vehicles !== undefined ? data[l].vehicles : detections[l].vehicles;
        detections[l].ambulance = data[l].ambulance !== undefined ? data[l].ambulance : detections[l].ambulance;
        detections[l].confidence = data[l].confidence !== undefined ? data[l].confidence : detections[l].confidence;
        // Accept bounding box arrays
        detections[l].boxes = Array.isArray(data[l].boxes) ? data[l].boxes : detections[l].boxes;
        detections[l].ambulanceBoxes = Array.isArray(data[l].ambulanceBoxes) ? data[l].ambulanceBoxes : detections[l].ambulanceBoxes;
      }
    }
    if (data.weather) detections.weather = data.weather;
  }
  res.json({ success: true });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Node Engine listening on port ${PORT}`);
});
