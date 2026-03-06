#include "DriveController.h"
#include <ESP32Servo.h>
#include <Arduino.h>

// ====== ESC control (for BLDC) ======
static Servo s_escL, s_escR;

static int  s_pinL, s_pinR;
static int  s_usMin      = 1000;    // 1.000 ms
static int  s_usMax      = 2000;    // 2.000 ms
static int  s_usNeutral  = 1500;    // 1.500 ms
static int  s_usDelta    = 400;     // ±400us around neutral for 100%
static int  s_deadbandUs = 40;      // snap to neutral if within this band
static bool s_invertL    = true;    // keep your polarity choices
static bool s_invertR    = false;
static bool s_reverseEnabled = true;

static TurnStyle s_turnMode = TURN_SAME_SIGN;

// ====== Behavior tuning (edit to taste) ======
static int  s_brakePct          = 25;    // % magnitude for the brake pulse
static int  s_brakeMs           = 350;   // duration of the brake pulse
static int  s_startBoostPctMin  = 40;    // if target is below this, temporarily boost to this
static int  s_startBoostMs      = 180;   // duration of startup boost
static int  s_minMovePct        = 8;     // below this we consider "effectively zero"
static int  s_slewPctPerSec     = 250;   // ramp limit (percent per second)
static int  s_updatePeriodMs    = 10;    // control task period

// ====== Internal control task ======
static TaskHandle_t s_driveTask = nullptr;

// ====== Helpers ======
static inline int clampi(int v, int lo, int hi){ return v<lo?lo:(v>hi?hi:v); }
static inline int sgn(int v){ return (v>0) - (v<0); }

static int pctToEscUs(int pct, bool invert){
  pct = clampi(pct, -100, 100);
  if (invert) pct = -pct;
  if (!s_reverseEnabled) pct = clampi(pct, 0, 100);
  int us = s_usNeutral + (pct * s_usDelta) / 100;
  if (abs(us - s_usNeutral) <= s_deadbandUs) us = s_usNeutral;
  if (us < s_usMin) us = s_usMin;
  if (us > s_usMax) us = s_usMax;
  return us;
}

static void writeBothUs(int l_us, int r_us){
  s_escL.writeMicroseconds(l_us);
  s_escR.writeMicroseconds(r_us);
}

static void escArm_sequence_robust(){
  // Try NEUTRAL-first (many car ESCs):
  writeBothUs(s_usNeutral, s_usNeutral);
  delay(1200);
  // brief min, then neutral again (some ESCs need to "see" min edge)
  writeBothUs(s_usMin, s_usMin);
  delay(300);
  writeBothUs(s_usNeutral, s_usNeutral);
  delay(500);

  // Show min a second time for ESCs expecting min-first
  writeBothUs(s_usMin, s_usMin);
  delay(700);
  writeBothUs(s_usNeutral, s_usNeutral);
  delay(500);
}

// ====== Per-motor state machine ======
enum Phase : uint8_t {
  PHASE_IDLE = 0,      // not moving (or holding neutral)
  PHASE_START_BOOST,   // short boost to overcome static friction
  PHASE_RUNNING,       // tracking target with slew limiting
  PHASE_BRAKE          // brief opposite command to counter inertia
};

struct MotorCtl {
  volatile int targetPct;     // user-requested target (-100..100)
  volatile int appliedPct;    // what we are currently outputting (-100..100)
  volatile Phase phase;       // current phase
  volatile uint32_t untilMs;  // phase end time (millis)
  int lastNonZeroSign;        // sign of last non-zero applied (-1/0/1)
};

static MotorCtl s_L{0,0,PHASE_IDLE,0,0};
static MotorCtl s_R{0,0,PHASE_IDLE,0,0};

// forward decl
static void setTargets(int lpct, int rpct);
static void requestForMotor(MotorCtl& m, int newTarget);
static void serviceOne(MotorCtl& m);
static void driveTaskFn(void*);

// ====== Public API ======
void Drive_init(int pinLeft, int pinRight, int usMin, int usMax, int usCenter){
  s_pinL = pinLeft; s_pinR = pinRight;
  s_usMin = usMin; s_usMax = usMax; s_usNeutral = usCenter;

  // MATCH your previous Python (PCA9685 @ 60 Hz)
  s_escL.setPeriodHertz(60);
  s_escR.setPeriodHertz(60);
  s_escL.attach(s_pinL, s_usMin, s_usMax);
  s_escR.attach(s_pinR, s_usMin, s_usMax);

  escArm_sequence_robust();

  // Reset states
  s_L = MotorCtl{0,0,PHASE_IDLE,0,0};
  s_R = MotorCtl{0,0,PHASE_IDLE,0,0};

  // Park at neutral
  writeBothUs(s_usNeutral, s_usNeutral);

  // Launch control task (pin to core 0 so you keep loop() on core 1)
  xTaskCreatePinnedToCore(driveTaskFn, "driveCtl", 4096, nullptr, 1, &s_driveTask, 0);
}

void Drive_stop(){
  setTargets(0, 0);
}

void Drive_setTurnMode(TurnStyle mode){
  s_turnMode = mode;
}

void Drive_setMaxDeltaUs(int deltaUs){
  s_usDelta = clampi(deltaUs, 200, 500);
}

void Drive_setReverseEnabled(bool enabled){
  s_reverseEnabled = enabled;
}

void Drive_percent(int leftPct, int rightPct){
  setTargets(leftPct, rightPct);
}

// ================== High-level mappings (kept) ==================
void Drive_forward(int pct){
  pct = clampi(pct, 0, 100);
  // your wiring maps forward to L=+pct, R=-pct
  setTargets(pct, -pct);
}

void Drive_backward(int pct){
  pct = clampi(pct, 0, 100);
  if (!s_reverseEnabled){ Drive_stop(); return; }
  setTargets(-pct, +pct);
}

void Drive_left(int pct){
  pct = clampi(pct, 0, 100);
  if (s_turnMode == TURN_SAME_SIGN) setTargets(-pct, -pct);
  else                              setTargets(-pct, +pct); // tank
}

void Drive_right(int pct){
  pct = clampi(pct, 0, 100);
  if (s_turnMode == TURN_SAME_SIGN) setTargets(+pct, +pct);
  else                              setTargets(+pct, -pct); // tank
}

// ====== Internals ======

static void requestForMotor(MotorCtl& m, int newTarget){
  newTarget = clampi(newTarget, -100, 100);

  // Read volatile fields once
  const int oldTarget = m.targetPct;
  const int oldApplied = m.appliedPct;
  const int oldSign = sgn(oldApplied);
  const int newSign = sgn(newTarget);

  m.targetPct = newTarget;
  const uint32_t now = millis();

  // Moving -> Stop : apply a brief opposite brake
  if (oldSign != 0 && newTarget == 0) {
    const int brakeCmd = -oldSign * s_brakePct; // opposite dir
    m.phase   = PHASE_BRAKE;
    m.untilMs = now + s_brakeMs;
    m.appliedPct = brakeCmd; // immediate feel
    return;
  }

  // Stop -> small move : startup boost
  if (oldSign == 0 && newSign != 0 && abs(newTarget) < s_startBoostPctMin) {
    const int boost = sgn(newTarget) * s_startBoostPctMin;
    m.phase   = PHASE_START_BOOST;
    m.untilMs = now + s_startBoostMs;
    m.appliedPct = boost;
    return;
  }

  // Direction flip while moving : short brake first
  if (oldSign != 0 && newSign != 0 && oldSign != newSign) {
    const int brakeCmd = -oldSign * s_brakePct;
    m.phase   = PHASE_BRAKE;
    m.untilMs = now + (s_brakeMs / 2);
    m.appliedPct = brakeCmd;
    return;
  }

  // Otherwise: running (or idle if target zero)
  m.phase = (newSign == 0 ? PHASE_IDLE : PHASE_RUNNING);
  // actual ramping happens in serviceOne()
}

static void setTargets(int lpct, int rpct){
  requestForMotor(s_L, lpct);
  requestForMotor(s_R, rpct);
}

static void serviceOne(MotorCtl& m){
  const uint32_t now = millis();

  // Work with locals to avoid volatile arithmetic hassles
  int applied = m.appliedPct;
  const int target = m.targetPct;

  switch (m.phase) {
    case PHASE_IDLE: {
      // Ramp toward zero gently
      int step = (s_slewPctPerSec * s_updatePeriodMs) / 1000;
      if (step < 1) step = 1;

      if (applied > s_minMovePct) {
        int next = applied - step;
        if (next < 0) next = 0;
        applied = next;
      } else if (applied < -s_minMovePct) {
        int next = applied + step;
        if (next > 0) next = 0;
        applied = next;
      } else {
        applied = 0;
      }
      break;
    }

    case PHASE_START_BOOST: {
      // keep current applied (boost) until phase ends
      if (now >= m.untilMs) {
        m.phase = (target == 0 ? PHASE_IDLE : PHASE_RUNNING);
      }
      break;
    }

    case PHASE_BRAKE: {
      // keep current applied (brake) until phase ends
      if (now >= m.untilMs) {
        m.phase = (target == 0 ? PHASE_IDLE : PHASE_RUNNING);
      }
      break;
    }

    case PHASE_RUNNING: {
      // Slew toward target
      int step = (s_slewPctPerSec * s_updatePeriodMs) / 1000;
      if (step < 1) step = 1;

      if (applied < target) {
        int inc = applied + step;
        applied = (inc > target) ? target : inc;
      } else if (applied > target) {
        int dec = applied - step;
        applied = (dec < target) ? target : dec;
      }

      // remember last non-zero sign
      if (abs(applied) >= s_minMovePct) m.lastNonZeroSign = sgn(applied);
      else if (target == 0)            m.lastNonZeroSign = 0;
      break;
    }
  }

  // Push back to volatile
  m.appliedPct = applied;
}

static void driveTaskFn(void*){
  TickType_t lastWake = xTaskGetTickCount();
  const TickType_t periodTicks = pdMS_TO_TICKS(s_updatePeriodMs);

  for (;;) {
    // Update both motors' state machines
    serviceOne(s_L);
    serviceOne(s_R);

    // Write once per cycle using current applied values
    const int lPct = s_L.appliedPct;
    const int rPct = s_R.appliedPct;
    const int lus  = pctToEscUs(lPct, s_invertL);
    const int rus  = pctToEscUs(rPct, s_invertR);
    writeBothUs(lus, rus);

    vTaskDelayUntil(&lastWake, periodTicks);
  }
}
