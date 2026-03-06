#pragma once
#include <Arduino.h>

// Initialize the lock servo (defaults: 50 Hz, 1000–2000 µs).
// lockDeg/unlockDeg let you define which side is “locked” vs “unlocked”.
void Lock_init(int servoPin,
               int minUs = 1000, int maxUs = 2000, int freqHz = 50,
               int lockDeg = 0, int unlockDeg = 180);

// Optional: change angles at runtime (0..180).
void Lock_setAngles(int lockDeg, int unlockDeg);

// Move smoothly to the LOCK angle and hold for holdMs (blocking).
void Lock_now(uint16_t holdMs = 1000, int stepDeg = 2, int stepDelayMs = 12);

// Move smoothly to the UNLOCK angle (one-way; no return) (blocking).
void Unlock_now(int stepDeg = 2, int stepDelayMs = 12);
