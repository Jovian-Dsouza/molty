#!/usr/bin/env python3
"""
Play an audio file on the device's speaker (default output device or specified device).

Usage:
  python play_audio.py <audio_file>
  python play_audio.py <audio_file> --device 0
  python play_audio.py --list-devices

Requirements:
  pip install sounddevice soundfile
"""

import argparse
import sys

try:
    import sounddevice as sd
    import soundfile as sf
except ImportError:
    print("Missing dependencies. Install with: pip install sounddevice soundfile", file=sys.stderr)
    sys.exit(1)


def list_devices() -> None:
    """Print available output devices."""
    print("Output devices (speakers):")
    print(sd.query_devices(kind="output"))


def play_file(path: str, device: int | None = None) -> None:
    """Play an audio file on the given device (default = system default speaker)."""
    data, sample_rate = sf.read(path, dtype="float32")
    if data.ndim == 1:
        channels = 1
    else:
        channels = data.shape[1]

    sd.play(data, sample_rate, device=device, blocking=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Play audio on the connected speaker.")
    parser.add_argument("audio_file", nargs="?", help="Path to audio file (WAV, FLAC, OGG, etc.)")
    parser.add_argument(
        "--device", "-d",
        type=int,
        default=None,
        help="Output device index (default: system default speaker). Use --list-devices to see indices.",
    )
    parser.add_argument(
        "--list-devices", "-l",
        action="store_true",
        help="List available output devices and exit.",
    )
    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        return 0

    if not args.audio_file:
        parser.error("audio_file required (or use --list-devices)")
        return 1

    try:
        play_file(args.audio_file, device=args.device)
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
