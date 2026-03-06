#include "Serial1API.h"
#include "ModeController.h"
#include "DriveController.h"
#include "LockController.h"


// ===== Protocol: AA 55 <LEN> <CMD> <PAYLOAD...> <CHK>  (CHK = XOR of [LEN..payload])
static const uint8_t PFX0 = 0xAA;
static const uint8_t PFX1 = 0x55;

// Commands
enum {
  CMD_MODE_SET  = 0x01,
  CMD_STOP_ALL  = 0x02,
  CMD_DRIVE_F   = 0x03,
  CMD_DRIVE_B   = 0x04,
  CMD_DRIVE_L   = 0x05,
  CMD_DRIVE_R   = 0x06,
  CMD_DRIVE_MIX = 0x07,
  CMD_TURNMODE  = 0x08,
  CMD_DMAX_SET  = 0x09,
  CMD_STATUS_Q  = 0x0A,
  CMD_LOCK      = 0x40,  // payload (optional): [hold_ms lo][hold_ms hi]
  CMD_UNLOCK    = 0x41,
};

// Responses
static const uint8_t RSP_ACK    = 0x80;
static const uint8_t RSP_ERR    = 0x81;
static const uint8_t RSP_STATUS = 0x82;

// Error codes
enum {
  E_BAD_ARG   = 1,
  E_BAD_MODE  = 2,
  E_NOT_IN_CAR= 3,
  E_UNKNOWN   = 4,
};

// rx state
static enum { S_WAIT_AA, S_WAIT_55, S_LEN, S_DATA, S_CHK } s_state = S_WAIT_AA;
static uint8_t  s_len=0;
static uint8_t  s_buf[32];
static uint8_t  s_pos=0;
static uint8_t  s_xor=0;

static inline void s_writeFrameHeader(uint8_t len, uint8_t cmd){
  Serial1.write(PFX0); Serial1.write(PFX1);
  Serial1.write(len);
  Serial1.write(cmd);
}
static inline void s_sendAck(){
  uint8_t len=1, cmd=RSP_ACK, ok=1, chk = len ^ cmd ^ ok;
  s_writeFrameHeader(len, cmd);
  Serial1.write(ok);
  Serial1.write(chk);
}
static inline void s_sendErr(uint8_t code){
  uint8_t len=2, cmd=RSP_ERR, chk = len ^ cmd ^ code;
  s_writeFrameHeader(len, cmd);
  Serial1.write(code);
  Serial1.write(chk);
}
static inline void s_sendStatus(){
  // payload: mode u8, active u8, turn u8, dmax u16 LE, reserved u8
  uint8_t mode = (uint8_t)Mode_get();
  uint8_t active = 0; // we can’t read internal activeRun, so infer by printing 0; (kept simple)
  uint8_t turn = 0;   // 0 SAME, 1 TANK
  // We need DriveController getters—since we don't expose them, return current config we *can* track:
  // For now, turn=0 (SAME). If you want exact, add getters in DriveController (optional).

  // dmax: we also don't have a getter; track it in DriveController if needed. Return 400 by default.
  uint16_t dmax = 400;

  uint8_t len = 6, cmd = RSP_STATUS;
  uint8_t chk = len ^ cmd;
  uint8_t b4 = (uint8_t)(dmax & 0xFF);
  uint8_t b5 = (uint8_t)(dmax >> 8);
  uint8_t reserved = 0;

  chk ^= mode; chk ^= active; chk ^= turn; chk ^= b4; chk ^= b5; chk ^= reserved;

  s_writeFrameHeader(len, cmd);
  Serial1.write(mode);
  Serial1.write(active);
  Serial1.write(turn);
  Serial1.write(b4);
  Serial1.write(b5);
  Serial1.write(reserved);
  Serial1.write(chk);
}

void S1_Init(long baud, int rxPin, int txPin){
  Serial1.begin(baud, SERIAL_8N1, rxPin, txPin);
}

static inline int16_t s_i8(int8_t v){ return (int16_t)v; }

static void s_dispatch(uint8_t cmd, const uint8_t* p, uint8_t n){
  switch (cmd){
    case CMD_MODE_SET: {
      if (n != 1) { s_sendErr(E_BAD_ARG); return; }
      uint8_t m = p[0];
      if (m==0) { Mode_setNone(); s_sendAck(); return; }
      if (m==1) { Mode_enter(MODE_CAR);   s_sendAck(); return; }
      if (m==2) { Mode_enter(MODE_DRONE); s_sendAck(); return; }
      s_sendErr(E_BAD_MODE); return;
    }

    case CMD_STOP_ALL: {
      Mode_stopAll();
      Drive_stop();
      s_sendAck();
      return;
    }

    case CMD_DRIVE_F:
    case CMD_DRIVE_B:
    case CMD_DRIVE_L:
    case CMD_DRIVE_R: {
      if (n != 1) { s_sendErr(E_BAD_ARG); return; }
      if (Mode_get() != MODE_CAR) { s_sendErr(E_NOT_IN_CAR); return; }
      Mode_cancelRun(); // abort transform run for manual drive
      uint8_t pct = p[0];
      if (pct > 100) pct = 100;

      if (cmd==CMD_DRIVE_F) Drive_forward(pct);
      else if (cmd==CMD_DRIVE_B) Drive_backward(pct);
      else if (cmd==CMD_DRIVE_L) Drive_left(pct);
      else Drive_right(pct);

      s_sendAck();
      return;
    }

    case CMD_DRIVE_MIX: {
      if (n != 2) { s_sendErr(E_BAD_ARG); return; }
      if (Mode_get() != MODE_CAR) { s_sendErr(E_NOT_IN_CAR); return; }
      Mode_cancelRun();
      int8_t lp = (int8_t)p[0];
      int8_t rp = (int8_t)p[1];
      // clamp
      if (lp < -100) lp = -100; if (lp > 100) lp = 100;
      if (rp < -100) rp = -100; if (rp > 100) rp = 100;
      Drive_percent(s_i8(lp), s_i8(rp));
      s_sendAck();
      return;
    }

    case CMD_TURNMODE: {
      if (n != 1) { s_sendErr(E_BAD_ARG); return; }
      uint8_t tm = p[0];
      if (tm==0) Drive_setTurnMode(TURN_SAME_SIGN);
      else if (tm==1) Drive_setTurnMode(TURN_TANK);
      else { s_sendErr(E_BAD_ARG); return; }
      s_sendAck(); return;
    }

    case CMD_DMAX_SET: {
      if (n != 2) { s_sendErr(E_BAD_ARG); return; }
      uint16_t d = (uint16_t)(p[0] | (uint16_t(p[1])<<8));
      if (d < 200) d = 200; if (d > 500) d = 500;
      Drive_setMaxDeltaUs((int)d);
      s_sendAck();
      return;
    }

    case CMD_STATUS_Q: {
      s_sendStatus();
      return;
    }
    case CMD_LOCK: {
      // optional payload: 2 bytes little-endian hold_ms
      uint16_t hold = 1000;
      if (n >= 2) hold = (uint16_t)(p[0] | (uint16_t(p[1])<<8));
      Lock_now(hold);
      s_sendAck();
      return;
    }

    case CMD_UNLOCK: {
      Unlock_now();
      s_sendAck();
      return;
    }

  }

  s_sendErr(E_UNKNOWN);
}

void S1_Update(){
  while (Serial1.available()){
    uint8_t b = (uint8_t)Serial1.read();

    switch (s_state){
      case S_WAIT_AA:
        if (b == PFX0) s_state = S_WAIT_55;
        break;

      case S_WAIT_55:
        s_state = (b == PFX1) ? S_LEN : S_WAIT_AA;
        break;

      case S_LEN:
        s_len = b;
        s_pos = 0;
        s_xor = b;             // include LEN
        if (s_len > sizeof(s_buf)) { s_state = S_WAIT_AA; } // oversize -> reset
        else s_state = S_DATA;
        break;

      case S_DATA:
        s_buf[s_pos++] = b;
        s_xor ^= b;
        if (s_pos == s_len) s_state = S_CHK;
        break;

      case S_CHK:
        if (b == s_xor){
          // s_buf[0] = CMD; rest is payload
          uint8_t cmd = s_buf[0];
          const uint8_t* payload = (s_len>=1) ? &s_buf[1] : nullptr;
          uint8_t n = (s_len>=1) ? (uint8_t)(s_len-1) : 0;
          s_dispatch(cmd, payload, n);
        }
        // regardless of pass/fail, reset to wait for next frame
        s_state = S_WAIT_AA;
        break;
    }
  }
}
