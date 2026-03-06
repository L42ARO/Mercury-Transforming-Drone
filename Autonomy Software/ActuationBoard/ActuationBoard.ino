// ================== Pins: TRANSFORMATION (H-bridge) ==================
// ================== Pins: TRANSFORMATION (H-bridge) ==================
#define ENA D10     // <— moved off D0 to free D0
#define IN1 D1
#define IN2 D2
#define IN3 D3
#define ENB D10     // (if ENA/ENB tie together in your board, keep both on D10 or split as needed)
#define IN4 39

// New: lock servo pin
#define LOCK_SERVO_PIN D0   // XIAO ESP32S3 D0 = GPIO1 (PWM-capable)


// ================== Pins: DRIVE SERVOS (DIFFERENTIAL) ==================
#define SERVO_LEFT_PIN  D9   // LEFT drive servo
#define SERVO_RIGHT_PIN D8   // RIGHT drive servo

// ================== LED ==================
#ifdef LED_BUILTIN
  #define LED_PIN LED_BUILTIN
#else
  #define LED_PIN 2
#endif
#define LED_ACTIVE_HIGH false

// ================== Timing ==================
const uint32_t CAR_RUN_MS   = 10000; // 10 s transform after MODE CAR
const uint32_t DRONE_RUN_MS = 10000; // 10 s transform after MODE DRONE
const uint32_t LED_DRONE_INTERVAL = 300; // blink while DRONE active

// ================== Serial1 (Raspberry Pi link) ==================
#define RX_PIN D7
#define TX_PIN D6
#define BAUD   115200

// ================== Includes ==================
#include "ModeController.h"
#include "DriveController.h"
#include "Serial1API.h"
#include "LockController.h"


// ================== Human CLI over USB Serial ==================
static String inBuf;
static inline int clampi(int v, int lo, int hi){ return v<lo?lo:(v>hi?hi:v); }

static void printHelp(){
  Serial.println(
    "\nCommands:\n"
    "  MODE CAR|DRONE|NONE     -> CAR/DRONE: run transform 10s, stop; mode is retained\n"
    "  S                        -> stop all motors (transform + servos), mode unchanged\n"
    "  F <pct>                  -> forward  [CAR only] (mapped to L-, R+)\n"
    "  B <pct>                  -> backward [CAR only] (mapped to L+, R-)\n"
    "  L <pct> / R <pct>        -> LEFT/RIGHT; SAME: L=(-,-) R=(+,+) | TANK: L=(-,+) R=(+,-)\n"
    "  TURNMODE SAME|TANK       -> SAME or TANK turning behavior\n"
    "  DMAX <us>                -> servoMaxDeltaUs (200..500)\n"
    "  M <L%> <R%>              -> mixed (-100..100) [CAR only]\n"
    "  LOCK [ms]                -> move to center and hold (default 1000 ms)\n"
    "  UNLOCK                   -> sweep 0→180→0\n"
    "  ? / HELP                 -> this help\n"
  );
}

static void handleLine(String s){
  s.trim(); if (!s.length()) return;
  s.replace("\t"," "); while (s.indexOf("  ") >= 0) s.replace("  ", " ");
  int sp = s.indexOf(' ');
  String cmd  = (sp>=0)? s.substring(0,sp) : s;
  String rest = (sp>=0)? s.substring(sp+1): "";
  cmd.toUpperCase();

  if (cmd=="?" || cmd=="HELP"){ printHelp(); return; }

  if (cmd=="MODE"){
    String m = rest; m.toUpperCase();
    if (m=="CAR"){   Mode_enter(MODE_CAR);   return; }
    if (m=="DRONE"){ Mode_enter(MODE_DRONE); return; }
    if (m=="NONE"){  Mode_setNone(); return; }
    Serial.println("ERR: MODE must be CAR, DRONE, or NONE");
    return;
  }

  if (cmd=="S"){
    Mode_stopAll();
    Drive_stop();
    Serial.println("OK: stop");
    return;
  }

  if (cmd=="TURNMODE"){
    String m = rest; m.toUpperCase();
    if (m=="SAME"){ Drive_setTurnMode(TURN_SAME_SIGN); Serial.println("OK: TURNMODE=SAME"); return; }
    if (m=="TANK"){ Drive_setTurnMode(TURN_TANK);      Serial.println("OK: TURNMODE=TANK");  return; }
    Serial.println("ERR: TURNMODE must be SAME or TANK");
    return;
  }

  if (cmd=="DMAX"){
    int v = rest.toInt(); v = clampi(v, 200, 500);
    Drive_setMaxDeltaUs(v);
    Serial.printf("OK: servoMaxDeltaUs=%d\n", v);
    return;
  }

  // ===== Drive (CAR mode only) =====
  if (cmd=="M" || cmd=="F" || cmd=="B" || cmd=="L" || cmd=="R"){
    if (Mode_get() != MODE_CAR && false){ Serial.println("ERR: Drive only in CAR mode. Use 'MODE CAR'."); return; }
    Mode_cancelRun(); // cancel any 10s transform run when taking manual drive

    if (cmd=="M"){
      int sp2 = rest.indexOf(' ');
      if (sp2 < 0){ Serial.println("ERR: M needs two values"); return; }
      int lp = rest.substring(0, sp2).toInt();
      int rp = rest.substring(sp2 + 1).toInt();
      Drive_percent(lp, rp);
      Serial.printf("OK: M L=%d%% R=%d%%\n", lp, rp);
      return;
    }

    int pct = clampi(rest.toInt(), 0, 100);
    if (cmd=="F"){ Drive_forward(pct);   Serial.printf("OK: F %d%%\n", pct); return; }
    if (cmd=="B"){ Drive_backward(pct);  Serial.printf("OK: B %d%%\n", pct); return; }
    if (cmd=="L"){ Drive_left(pct);      Serial.printf("OK: L %d%%\n", pct); return; }
    if (cmd=="R"){ Drive_right(pct);     Serial.printf("OK: R %d%%\n", pct); return; }
  }

    if (cmd=="LOCK"){
    int hold = rest.length() ? rest.toInt() : 1000;
    if (hold <= 0) hold = 1000;
    Lock_now((uint16_t)hold);
    Serial.printf("OK: LOCK %dms\n", hold);
    return;
  }

  if (cmd=="UNLOCK"){
    Unlock_now();
    Serial.println("OK: UNLOCK sweep");
    return;
  }


  Serial.println("ERR: unknown command. Type '?' for help.");
}

// ================== Arduino ==================
void setup(){
  Serial.begin(115200);

  // Binary API for Raspberry Pi on Serial1
  S1_Init(BAUD, RX_PIN, TX_PIN);

  // Init controllers
  Mode_init(ENA, ENB, IN1, IN2, IN3, IN4,
            LED_PIN, LED_ACTIVE_HIGH,
            CAR_RUN_MS, DRONE_RUN_MS, LED_DRONE_INTERVAL);

  Drive_init(SERVO_LEFT_PIN, SERVO_RIGHT_PIN, 1000, 2000, 1500);

  // NEW: Lock controller (50 Hz, 1000–2000us)
  Lock_init(LOCK_SERVO_PIN, 1000, 2000, 50);

  // If your Serial1API supports registering a handler, do it here:
  // S1_RegisterHandler(Lock_S1_Handle);

  Serial.println("Ready. USB Serial = human CLI ('?'), Serial1 = Pi binary API.");
  Serial.println("Start with 'MODE CAR' or 'MODE DRONE'.");
}

void loop(){
  // Human CLI over USB
  while (Serial.available()){
    char c = (char)Serial.read();
    if (c == '\r') continue;
    if (c == '\n'){ handleLine(inBuf); inBuf = ""; }
    else {
      inBuf += c;
      if (inBuf.length() > 160) inBuf = "";
    }
  }

  // Background engines
  Mode_update();  // handles 10s timeout & LED blink
  S1_Update();    // parses/dispatches Raspberry Pi frames
}
