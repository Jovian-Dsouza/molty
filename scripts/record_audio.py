#!/usr/bin/env python3
"""
Record audio from the device's microphone and save to a file (WAV).
Output can be played with play_audio.py.

Usage:
  python record_audio.py [output.wav]
  python record_audio.py recording.wav --duration 10
  python record_audio.py --list-devices

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

DEFAULT_SAMPLE_RATE = 44100
DEFAULT_CHANNELS = 1


def list_devices() -> None:
    """Print available input devices."""
    print("Input devices (microphones):")
    print(sd.query_devices(kind="input"))


def record_to_file(
    path: str,
    *,
    device: int | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
    channels: int = DEFAULT_CHANNELS,
    duration: float | None = None,
) -> None:
    """Record audio and save to a WAV file."""
    print(f"Recording to {path} (sample_rate={sample_rate}, channels={channels})")
    if duration is not None:
        print(f"Duration: {duration}s (or press Ctrl+C to stop early)")
    else:
        print("Press Ctrl+C to stop recording")

    def callback(indata, frames, time_info, status):
        if status:
            print(status, file=sys.stderr)
        q.put(indata.copy())

    try:
        import queue
        q = queue.Queue()

        with sd.InputStream(
            device=device,
            channels=channels,
            samplerate=sample_rate,
            dtype="float32",
            blocksize=1024,
            callback=callback,
        ):
            if duration is not None:
                import time
                total_frames = int(duration * sample_rate)
                frames_written = 0
                with sf.SoundFile(
                    path,
                    mode="w",
                    samplerate=sample_rate,
                    channels=channels,
                    subtype="FLOAT",
                ) as f:
                    while frames_written < total_frames:
                        remaining = total_frames - frames_written
                        to_read = min(remaining, 1024)
                        try:
                            block = q.get(timeout=1.0)
                        except Exception:
                            break
                        to_write = block[:to_read]
                        f.write(to_write)
                        frames_written += len(to_write)
            else:
                with sf.SoundFile(
                    path,
                    mode="w",
                    samplerate=sample_rate,
                    channels=channels,
                    subtype="FLOAT",
                ) as f:
                    while True:
                        try:
                            f.write(q.get())
                        except KeyboardInterrupt:
                            break
    except KeyboardInterrupt:
        pass

    print(f"Saved: {path}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Record audio from the microphone. Play with play_audio.py."
    )
    parser.add_argument(
        "output_file",
        nargs="?",
        default="recording.wav",
        help="Output WAV file path (default: recording.wav)",
    )
    parser.add_argument(
        "--device", "-d",
        type=int,
        default=None,
        help="Input device index (default: system default microphone). Use --list-devices.",
    )
    parser.add_argument(
        "--duration", "-t",
        type=float,
        default=None,
        metavar="SECONDS",
        help="Record for this many seconds, then stop. Omit to record until Ctrl+C.",
    )
    parser.add_argument(
        "--sample-rate", "-r",
        type=int,
        default=DEFAULT_SAMPLE_RATE,
        help=f"Sample rate in Hz (default: {DEFAULT_SAMPLE_RATE}).",
    )
    parser.add_argument(
        "--channels", "-c",
        type=int,
        default=DEFAULT_CHANNELS,
        choices=(1, 2),
        help=f"Number of channels (default: {DEFAULT_CHANNELS}).",
    )
    parser.add_argument(
        "--list-devices", "-l",
        action="store_true",
        help="List available input devices and exit.",
    )
    args = parser.parse_args()

    if args.list_devices:
        list_devices()
        return 0

    if not args.output_file.endswith(".wav"):
        args.output_file = args.output_file.rstrip("/") + ".wav"

    try:
        record_to_file(
            args.output_file,
            device=args.device,
            sample_rate=args.sample_rate,
            channels=args.channels,
            duration=args.duration,
        )
        return 0
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
