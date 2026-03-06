#pragma once
#include <Arduino.h>

// Pin + baud config
void S1_Init(long baud, int rxPin, int txPin);

// Call often in loop(); parses frames and dispatches to controllers
void S1_Update();
