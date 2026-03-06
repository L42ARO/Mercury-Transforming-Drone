#include "LockController.h"
#include <ESP32Servo.h>

static Servo s;
static int g_minUs = 1000, g_maxUs = 2000;
static int g_lockDeg = 0;      // “locked/closed” angle
static int g_unlockDeg = 180;  // “unlocked/open” angle
static int g_currentDeg = -1;  // unknown until first write

static inline int clampi(int v, int lo, int hi){ return v<lo?lo:(v>hi?hi:v); }

// Smooth move helper from current to target
static void moveToDeg(int targetDeg, int stepDeg, int stepDelayMs) {
  targetDeg = clampi(targetDeg, 0, 180);
  stepDeg   = clampi(stepDeg,   1,  30);

  // Initialize currentDeg on first use by reading back center
  if (g_currentDeg < 0) {
    // Try to infer from a neutral write; default to lock angle
    g_currentDeg = clampi(g_lockDeg, 0, 180);
    s.write(g_currentDeg);
    delay(10);
  }

  int dir = (targetDeg >= g_currentDeg) ? +1 : -1;
  while (g_currentDeg != targetDeg) {
    g_currentDeg += dir * stepDeg;
    if ((dir > 0 && g_currentDeg > targetDeg) ||
        (dir < 0 && g_currentDeg < targetDeg)) {
      g_currentDeg = targetDeg;
    }
    s.write(g_currentDeg);
    delay(stepDelayMs);
  }
}

void Lock_init(int servoPin, int minUs, int maxUs, int freqHz, int lockDeg, int unlockDeg) {
  g_minUs = minUs; g_maxUs = maxUs;
  g_lockDeg = clampi(lockDeg, 0, 180);
  g_unlockDeg = clampi(unlockDeg, 0, 180);
  s.setPeriodHertz(freqHz);
  s.attach(servoPin, minUs, maxUs);
  g_currentDeg = -1; // unknown until first move
}

void Lock_setAngles(int lockDeg, int unlockDeg) {
  g_lockDeg = clampi(lockDeg, 0, 180);
  g_unlockDeg = clampi(unlockDeg, 0, 180);
}

// LOCK = do the “return half” (e.g., 180 → 0) and then hold briefly
void Lock_now(uint16_t holdMs, int stepDeg, int stepDelayMs) {
  moveToDeg(g_lockDeg, stepDeg, stepDelayMs);
  if (holdMs) delay(holdMs);
}

// UNLOCK = do the “first half” only (e.g., 0 → 180). No auto return.
void Unlock_now(int stepDeg, int stepDelayMs) {
  moveToDeg(g_unlockDeg, stepDeg, stepDelayMs);
}
