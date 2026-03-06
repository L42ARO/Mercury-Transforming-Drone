#include "ModeController.h"

// ====== internal storage (no classes, just statics) ======
static int s_ENA, s_ENB, s_IN1, s_IN2, s_IN3, s_IN4;
static int s_LED_PIN;
static bool s_LED_ACTIVE_HIGH;
static uint32_t s_CAR_RUN_MS, s_DRONE_RUN_MS, s_LED_DRONE_INTERVAL;

static ModeState s_mode = MODE_NONE;
static bool s_modeActiveRun = false;
static uint32_t s_modeStartMs = 0;

enum LedMode { LED_OFF,
               LED_SOLID,
               LED_BLINK };
static LedMode s_ledMode = LED_OFF;
static uint32_t s_ledLastToggleMs = 0;
static bool s_ledOn = false;

static inline void writeLed(bool on) {
  if (s_LED_ACTIVE_HIGH) digitalWrite(s_LED_PIN, on ? HIGH : LOW);
  else digitalWrite(s_LED_PIN, on ? LOW : HIGH);
}
static void setLedMode(LedMode m) {
  s_ledMode = m;
  s_ledLastToggleMs = millis();
  if (m == LED_OFF) {
    s_ledOn = false;
    writeLed(false);
  }
  if (m == LED_SOLID) {
    s_ledOn = true;
    writeLed(true);
  }
  if (m == LED_BLINK) {
    s_ledOn = false;
    writeLed(false);
  }
}
static void updateLedBlink() {
  if (s_ledMode != LED_BLINK) return;
  uint32_t now = millis();
  if (now - s_ledLastToggleMs >= s_LED_DRONE_INTERVAL) {
    s_ledLastToggleMs = now;
    s_ledOn = !s_ledOn;
    writeLed(s_ledOn);
  }
}

// H-bridge helpers
static void transStop() {
  digitalWrite(s_IN1, LOW);
  digitalWrite(s_IN2, LOW);
  digitalWrite(s_IN3, LOW);
  digitalWrite(s_IN4, LOW);
  analogWrite(s_ENA, 0);
  analogWrite(s_ENB, 0);
}

// Inverted from your earlier mapping (as requested):
// New CAR mapping (was DRONE/forward before)
static void transCarMappingFull() {
  analogWrite(s_ENA, 255);
  analogWrite(s_ENB, 255);
  digitalWrite(s_IN1, LOW);
  digitalWrite(s_IN2, HIGH);
  digitalWrite(s_IN3, LOW);
  digitalWrite(s_IN4, HIGH);
}

// New DRONE mapping (was CAR/reverse before)
static void transDroneMappingFull() {
  analogWrite(s_ENA, 255);
  analogWrite(s_ENB, 255);
  digitalWrite(s_IN1, HIGH);
  digitalWrite(s_IN2, LOW);
  digitalWrite(s_IN3, HIGH);
  digitalWrite(s_IN4, LOW);
}

void Mode_init(
  int ena, int enb,
  int in1, int in2, int in3, int in4,
  int ledPin, bool ledActiveHigh,
  uint32_t carRunMs, uint32_t droneRunMs, uint32_t ledDroneInterval) {
  s_ENA = ena;
  s_ENB = enb;
  s_IN1 = in1;
  s_IN2 = in2;
  s_IN3 = in3;
  s_IN4 = in4;

  pinMode(s_IN1, OUTPUT);
  pinMode(s_IN2, OUTPUT);
  pinMode(s_IN3, OUTPUT);
  pinMode(s_IN4, OUTPUT);
  pinMode(s_ENA, OUTPUT);
  pinMode(s_ENB, OUTPUT);
  transStop();

  s_LED_PIN = ledPin;
  s_LED_ACTIVE_HIGH = ledActiveHigh;
  pinMode(s_LED_PIN, OUTPUT);
  writeLed(false);

  s_CAR_RUN_MS = carRunMs;
  s_DRONE_RUN_MS = droneRunMs;
  s_LED_DRONE_INTERVAL = ledDroneInterval;

  s_mode = MODE_NONE;
  s_modeActiveRun = false;
  setLedMode(LED_OFF);
}

void Mode_enter(ModeState newMode) {
  s_mode = newMode;
  s_modeActiveRun = true;
  s_modeStartMs = millis();

  if (s_mode == MODE_CAR) {
    Serial.println("[MODE] CAR: transformation motors RUN 10s, then stop (mode retained).");
    transCarMappingFull();
    setLedMode(LED_SOLID);
  } else if (s_mode == MODE_DRONE) {
    Serial.println("[MODE] DRONE: transformation motors RUN 10s, then stop (mode retained).");
    transDroneMappingFull();
    setLedMode(LED_BLINK);
  } else {
    // MODE_NONE shouldn't start a run
    s_modeActiveRun = false;
    setLedMode(LED_OFF);
  }
}

void Mode_stopAll() {
  transStop();
  setLedMode(LED_OFF);
  // mode unchanged
}

void Mode_setNone() {
  s_mode = MODE_NONE;
  s_modeActiveRun = false;
  transStop();
  setLedMode(LED_OFF);
  Serial.println("[MODE] NONE.");
}

void Mode_cancelRun() {
  s_modeActiveRun = false;
}

void Mode_update() {
  // 10s timeout handler
  if (s_modeActiveRun) {
    uint32_t now = millis();
    if (s_mode == MODE_CAR && (now - s_modeStartMs >= s_CAR_RUN_MS)) {
      transStop();
      setLedMode(LED_OFF);
      s_modeActiveRun = false;
      Serial.println("[MODE] CAR: 10s run complete; stopped (mode retained).");
    } else if (s_mode == MODE_DRONE && (now - s_modeStartMs >= s_DRONE_RUN_MS)) {
      transStop();
      setLedMode(LED_OFF);
      s_modeActiveRun = false;
      Serial.println("[MODE] DRONE: 10s run complete; stopped (mode retained).");
    }
  }
  // LED blink
  updateLedBlink();
}

ModeState Mode_get() {
  return s_mode;
}
