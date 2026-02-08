# Raspberry Pi Setup Guide

## Initial System Update
```bash
sudo apt update && sudo apt upgrade -y
sudo apt-get install --no-install-recommends xserver-xorg x11-xserver-utils xinit openbox chromium vim git -y
sudo apt install -y build-essential python3 make g++
sudo apt install -y sqlite3 libsqlite3-dev
```

## Install Node.js
```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v

curl -fsSL https://get.pnpm.io/install.sh | sh -
```

## Install Fonts
```bash
sudo apt install -y \
  fonts-dejavu \
  fonts-liberation \
  fonts-noto \
  fonts-noto-core \
  fonts-noto-extra \
  fonts-noto-color-emoji \
  fonts-roboto \
  fonts-freefont-ttf \
  fonts-opensymbol

sudo fc-cache -fv
fc-list | grep -i emoji
```

## Install LCD Driver
```bash
git clone https://github.com/goodtft/LCD-show.git
chmod -R 755 LCD-show
cd LCD-show/
sudo ./LCD35-show
```

## Configure Auto Login
After reboot, run:
```bash
sudo raspi-config
```
Navigate to: System Options > Auto Login > Enable

## Configure Display Settings

### Update `.bash_profile`
```bash
startx -- -nocursor
```

### Configure Openbox Autostart
Edit `/etc/xdg/openbox/autostart`:
```bash
sudo vim /etc/xdg/openbox/autostart
```

Add the following:
```bash
# Disable any form of screen saver / screen blanking / power management
xset s off
xset s noblank
xset -dpms
xrandr -s 320x480
```

### Update `.bashrc`
Edit `~/.bashrc`:
```bash
sudo vim ~/.bashrc
```

Add:
```bash
export DISPLAY=:0
export XAUTHORITY=/home/pi/.Xauthority
```

## Rotate Display
```bash
cd LCD-show
sudo ./rotate.sh 270
```

## Reboot
```bash
sudo reboot
```

## Additional Dependencies
```bash
pnpm add -g prebuild-install
```

## MEMS I2S Microphone Setup

### Hardware Connections
Connect the MEMS I2S microphone (SPH0645 or similar) to the Raspberry Pi:
- **3.3V** → 3.3V Power
- **GND** → Ground (0V)
- **BCLK** (Bit Clock) → GPIO 18
- **DOUT** (Data Out) → GPIO 20
- **LRCL** (Left/Right Clock) → GPIO 19
- **SEL** (Left/Right Channel Selection) → Ground

### Configure Kernel for I2S

Edit the boot configuration:
```bash
sudo nano /boot/firmware/config.txt
```

Ensure the following lines are set (add or modify as needed):
```bash
#dtparam=i2c_arm=on
dtparam=i2s=on
#dtoverlay=i2s-mems-mic
#dtparam=spi=on
dtoverlay=googlevoicehat-soundcard
# Enable audio (loads snd_bcm2835)
dtparam=audio=on
```

Disable HDMI audio by adding `noaudio` to the VC4 overlay:
```bash
# Enable DRM VC4 V3D driver
dtoverlay=vc4-kms-v3d,noaudio
```

Reboot to apply changes:
```bash
sudo reboot
```

### Verify Hardware Detection

Check that the microphone is detected:
```bash
arecord -l
```

Expected output:
```
**** List of CAPTURE Hardware Devices ****
card 0: sndrpigooglevoi [snd_rpi_googlevoicehat_soundcar], device 0: Google voiceHAT SoundCard HiFi voicehat-hifi-0
  Subdevices: 1/1
  Subdevice #0: subdevice #0
```

Check hardware parameters (note the card and device numbers):
```bash
arecord -D hw:0,0 --dump-hw-params
```

Look for:
- **FORMAT**: S32_LE
- **CHANNELS**: 2
- **RATE**: 48000

### Configure ALSA

Edit the ALSA configuration:
```bash
sudo nano /etc/asound.conf
```

Replace contents with:
```bash
# Define the hardware device for the Google Voice HAT mic
pcm.mic_hw {
    type hw
    card 0         # Your Google Voice HAT card number
    device 0       # Usually 0 for this device
    channels 2     # Google Voice HAT mic is stereo
    format S32_LE  # 32-bit little endian format
    rate 48000     # 48kHz sample rate
}

# Define the software volume control layer
pcm.mic_sv {
    type softvol
    slave {
        pcm "mic_hw"
    }
    control {
        name "Mic Capture Volume"
        card 0 # Use the same card number as above
    }
    min_dB -3.0   # Minimum dB gain
    max_dB 20.0   # Maximum dB gain - adjust if needed
    resolution 256
}

# Make this new software volume device the default for capture
pcm.!default {
    type asym
    playback.pcm "default"  # Keep default playback
    capture.pcm "mic_sv"    # Use softvol device for capture
}
```

Activate the settings:
```bash
arecord -D mic_sv -f S32_LE -r 48000 -c 2 -d 1 /dev/null
```

### Set ALSA Mixer Gain

Open the ALSA mixer:
```bash
alsamixer
```

1. Press **F6** to select the device → Choose **default:0** (Google Voice HAT)
2. Press **F4** to view capture settings
3. Use **↑/↓** arrow keys to adjust gain (recommended: 8-10 dB)
4. Press **ESC** to exit

Save the settings:
```bash
sudo alsactl store
```

### Workaround for Settings Restoration

Due to issues with automatic restoration, manually set gain before running your application:
```bash
amixer -D hw:0 sset 'Mic' 10dB
```

Verify the mixer settings:
```bash
amixer -D hw:0
```

### Testing the Microphone

Record 5 seconds of audio to RAM:
```bash
arecord -D mic_sv -f S32_LE -r 48000 -c 2 /dev/shm/test_ram_recording.wav -d 5
```

Transfer to another machine for playback (from your Mac/PC):
```bash
scp pi@<raspberry-pi-ip>:/dev/shm/test_ram_recording.wav .
```

### Python Audio Capture

Use the following in your Python script to capture audio:
```python
import sounddevice as sd

SAMPLE_RATE = 48000
CHANNELS = 2
DTYPE = 'int32'

with sd.InputStream(
    samplerate=SAMPLE_RATE,
    channels=CHANNELS,
    dtype=DTYPE,
    callback=audio_callback,
    device='mic_sv'):
    # Your audio processing code
```

### Known Issues

1. **DC Offset**: Small negative DC offset present - can be removed by subtracting average signal level
2. **Thump on Power-up**: Occasional 'thump' noise (~600-700ms) - use high-pass filtering or let AI training handle it
3. **Settings Not Restored**: ALSA settings may not restore on reboot - use the `amixer` command workaround in startup scripts
