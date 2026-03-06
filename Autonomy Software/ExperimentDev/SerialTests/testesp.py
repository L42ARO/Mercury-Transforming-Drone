import serial

# Use the correct UART device
ser = serial.Serial("/dev/ttyAMA1", 115200, timeout=1)

print("Type a message and press Enter to send. Press Ctrl+C to exit.")
try:
    while True:
        msg = input("You: ")  # Get user input from keyboard
        ser.write((msg + "\n").encode())  # Send to ESP32

        # Wait for echo response
        response = ser.readline().decode(errors='ignore').strip()
        if response:
            print("ESP32:", response)

except KeyboardInterrupt:
    print("\nExiting.")
    ser.close()