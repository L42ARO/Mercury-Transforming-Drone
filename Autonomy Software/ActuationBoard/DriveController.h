#pragma once
#include <Arduino.h>

enum TurnStyle { TURN_SAME_SIGN, TURN_TANK };

void Drive_init(int pinLeft, int pinRight, int usMin, int usMax, int usCenter);
void Drive_stop();
void Drive_setTurnMode(TurnStyle mode);
void Drive_setMaxDeltaUs(int deltaUs);

// Raw percent drive (-100..100 per side)
void Drive_percent(int leftPct, int rightPct);

// High-level commands (use in CAR mode only)
void Drive_forward(int pct);   // mapped to L-, R+  (flipped per your observation)
void Drive_backward(int pct);  // mapped to L+, R-  (flipped per your observation)
void Drive_left(int pct);
void Drive_right(int pct);
