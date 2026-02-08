# Circuit Wiring Diagram

## DRV8233 Motor Driver

| DRV8233 Pin | GPIO Pin | Wire Color | Notes |
|-------------|----------|------------|-------|
| AIN1 | GPIO 1 | White | Motor A Direction |
| AIN2 | GPIO 12 (PWM) | Black | Motor A Speed |
| STBY | GPIO 26 | Green | Standby |
| BIN1 | GPIO 6 | Red | Motor B Direction |
| BIN2 | GPIO 13 (PWM) | Yellow | Motor B Speed |
| GND | GND | - | Ground |

## Servo Motors

- **Servo 1**: GPIO 20
- **Servo 2**: GPIO 5

## INMP441 I2S Microphone

| INMP441 Pin | Raspberry Pi Pin | Wire Color | Notes |
|-------------|------------------|------------|-------|
| VDD | 3.3V | Red | Power |
| GND | GND | Black | Ground |
| SD | GPIO 20 (PCM_DIN) | Blue | Serial Data |
| WS | GPIO 19 (PCM_FS) | Green | Word Select / LRCLK |
| SCK | GPIO 18 (PCM_CLK) | Orange | Serial Clock / BCLK |
| L/R | GND | - | Left/Right Select (GND = Left) |

### Reference
- [Setting up a MEMS I2S Microphone on Raspberry Pi](https://medium.com/@martin.hodges/setting-up-a-mems-i2s-microphone-on-a-raspberry-pi-306248961043)
