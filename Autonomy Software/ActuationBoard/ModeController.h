#pragma once
#include <Arduino.h>

enum ModeState { MODE_NONE, MODE_CAR, MODE_DRONE };

// Initialize the transformation controller & LED
void Mode_init(
  int ena, int enb,
  int in1, int in2, int in3, int in4,
  int ledPin, bool ledActiveHigh,
  uint32_t carRunMs, uint32_t droneRunMs, uint32_t ledDroneInterval
);

// Enter CAR/DRONE (starts 10s transform run) or use Mode_setNone()
void Mode_enter(ModeState newMode);

// Immediately stop transform motors + turn LED off (mode unchanged)
void Mode_stopAll();

// Set to MODE_NONE (no active run, LED off, transform stopped)
void Mode_setNone();

// Cancel ongoing 10s run (keeps current mode)
void Mode_cancelRun();

// Should be called in loop(): handles 10s timeout + LED blink
void Mode_update();

// Get current mode
ModeState Mode_get();
