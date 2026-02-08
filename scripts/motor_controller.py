#!/usr/bin/env python3
"""
Motor controller for Molty — reads newline-delimited JSON commands from stdin
and drives two DC motors via a TB6612 motor driver and two servo motors on
Raspberry Pi GPIO.

GPIO Pins:
  Motor A: GPIO 1 (forward), GPIO 12 (backward)
  Motor B: GPIO 13 (forward), GPIO 6 (backward)
  Standby: GPIO 26
  Servo 1 (left claw):  GPIO 5
  Servo 2 (right claw): GPIO 21

Command protocol (stdin, one JSON per line):
  {"command": "set_emotion", "emotion": "celebrating"}
  {"command": "set_servos", "angle1": 90, "angle2": 90}
  {"command": "stop"}
  {"command": "shutdown"}

Status output (stdout, one JSON per line):
  {"type": "status", "status": "ready", "message": "..."}
  {"type": "status", "status": "emotion_changed", "message": "..."}
  {"type": "status", "status": "servos_set", "message": "..."}
  {"type": "status", "status": "error", "message": "..."}
  {"type": "status", "status": "shutdown", "message": "..."}
"""

import json
import sys
import threading
import time
import signal

# ── GPIO Setup (graceful degradation) ────────────────────────────────────────

SIMULATION_MODE = False

try:
    from gpiozero import Motor, OutputDevice
except ImportError:
    SIMULATION_MODE = True

SERVO_AVAILABLE = False
try:
    import RPi.GPIO as GPIO
    SERVO_AVAILABLE = True
except ImportError:
    pass

# Motor instances (set up after import check)
motor_a = None
motor_b = None
standby = None

if not SIMULATION_MODE:
    try:
        motor_a = Motor(forward=1, backward=12)
        motor_b = Motor(forward=13, backward=6)
        standby = OutputDevice(26, initial_value=True)
    except Exception as e:
        SIMULATION_MODE = True

# Servo PWM instances (RPi.GPIO)
pwm_servo_1 = None
pwm_servo_2 = None

if not SIMULATION_MODE and SERVO_AVAILABLE:
    try:
        GPIO.setmode(GPIO.BCM)
        GPIO.setup(5, GPIO.OUT)
        GPIO.setup(21, GPIO.OUT)
        pwm_servo_1 = GPIO.PWM(5, 50)
        pwm_servo_2 = GPIO.PWM(21, 50)
        pwm_servo_1.start(0)
        pwm_servo_2.start(0)
    except Exception:
        SERVO_AVAILABLE = False


# ── Helpers ──────────────────────────────────────────────────────────────────

def emit_status(status: str, message: str = ""):
    """Write a status JSON line to stdout for Electron to parse."""
    obj = {"type": "status", "status": status, "message": message}
    try:
        sys.stdout.write(json.dumps(obj) + "\n")
        sys.stdout.flush()
    except BrokenPipeError:
        pass


MAX_SPEED = 0.1


def drive(speed_a: float, speed_b: float):
    """Set motor speeds. Positive = forward, negative = backward, 0 = stop."""
    if SIMULATION_MODE:
        return
    speed_a = max(-MAX_SPEED, min(MAX_SPEED, speed_a))
    speed_b = max(-MAX_SPEED, min(MAX_SPEED, speed_b))
    if speed_a > 0:
        motor_a.forward(min(abs(speed_a), 1.0))
    elif speed_a < 0:
        motor_a.backward(min(abs(speed_a), 1.0))
    else:
        motor_a.stop()

    if speed_b > 0:
        motor_b.forward(min(abs(speed_b), 1.0))
    elif speed_b < 0:
        motor_b.backward(min(abs(speed_b), 1.0))
    else:
        motor_b.stop()


def stop_motors():
    """Immediately stop both motors."""
    if SIMULATION_MODE:
        return
    motor_a.stop()
    motor_b.stop()


def set_servo_angle(pwm, angle: float):
    """Move a single servo to the given angle using tested duty-cycle formula."""
    if pwm is None:
        return
    duty = 2 + (angle / 18)
    pwm.ChangeDutyCycle(duty)
    time.sleep(0.5)
    pwm.ChangeDutyCycle(0)


def set_servos(angle1: float, angle2: float):
    """Set both servos to given angles (0-180)."""
    if SIMULATION_MODE or not SERVO_AVAILABLE:
        return
    set_servo_angle(pwm_servo_1, max(0, min(180, angle1)))
    set_servo_angle(pwm_servo_2, max(0, min(180, angle2)))


def center_servos():
    """Move servos to neutral position (90 degrees)."""
    set_servos(90, 90)


def detach_servos():
    """Stop sending PWM signal to prevent jitter."""
    if SIMULATION_MODE or not SERVO_AVAILABLE:
        return
    pwm_servo_1.ChangeDutyCycle(0)
    pwm_servo_2.ChangeDutyCycle(0)


def interruptible_sleep(seconds: float, stop_event: threading.Event, step: float = 0.05):
    """Sleep in small steps, returning True if interrupted."""
    elapsed = 0.0
    while elapsed < seconds:
        if stop_event.is_set():
            return True
        time.sleep(step)
        elapsed += step
    return stop_event.is_set()


# ── Animation Functions ──────────────────────────────────────────────────────
# Each takes a stop_event for interruptibility. Returns when done or interrupted.

def anim_idle(stop_event: threading.Event):
    """Gentle creep forward/back at low speed — loops until interrupted."""
    while not stop_event.is_set():
        drive(0.15, 0.15)
        set_servos(70, 70)
        if interruptible_sleep(1.0, stop_event):
            break
        drive(-0.15, -0.15)
        set_servos(110, 110)
        if interruptible_sleep(1.0, stop_event):
            break
    stop_motors()
    detach_servos()


def anim_listening(stop_event: threading.Event):
    """Stop motors — attentive/still. Claws open wide."""
    stop_motors()
    set_servos(150, 150)
    detach_servos()


def anim_thinking(stop_event: threading.Event):
    """Stop motors — processing. Arms rotate back and forth."""
    stop_motors()
    while not stop_event.is_set():
        set_servos(45, 135)
        if interruptible_sleep(1.0, stop_event):
            break
        set_servos(135, 45)
        if interruptible_sleep(1.0, stop_event):
            break
    detach_servos()


def anim_excited(stop_event: threading.Event):
    """Quick spins + forward dart + reverse. Rapid claw snapping."""
    # Quick spin right + claws open
    drive(0.7, -0.7)
    set_servos(150, 150)
    if interruptible_sleep(0.3, stop_event):
        stop_motors(); detach_servos(); return
    # Quick spin left + claws snap shut
    drive(-0.7, 0.7)
    set_servos(30, 30)
    if interruptible_sleep(0.3, stop_event):
        stop_motors(); detach_servos(); return
    # Forward dart + claws open
    drive(0.8, 0.8)
    set_servos(150, 150)
    if interruptible_sleep(0.4, stop_event):
        stop_motors(); detach_servos(); return
    # Reverse + claws snap shut
    drive(-0.5, -0.5)
    set_servos(30, 30)
    if interruptible_sleep(0.3, stop_event):
        stop_motors(); detach_servos(); return
    stop_motors()
    detach_servos()


def anim_watching(stop_event: threading.Event):
    """Subtle left/right wiggle — loops until interrupted. Alternating claws."""
    while not stop_event.is_set():
        drive(0.2, -0.2)
        set_servos(150, 30)
        if interruptible_sleep(0.4, stop_event):
            break
        drive(-0.2, 0.2)
        set_servos(30, 150)
        if interruptible_sleep(0.4, stop_event):
            break
    stop_motors()
    detach_servos()


def anim_winning(stop_event: threading.Event):
    """Forward/back burst + spin sequence. Victory claps."""
    # Forward burst + claws wide
    drive(0.8, 0.8)
    set_servos(180, 180)
    if interruptible_sleep(0.4, stop_event):
        stop_motors(); detach_servos(); return
    # Back burst + claws snap
    drive(-0.6, -0.6)
    set_servos(0, 0)
    if interruptible_sleep(0.3, stop_event):
        stop_motors(); detach_servos(); return
    # Spin right + claws open
    drive(0.9, -0.9)
    set_servos(180, 180)
    if interruptible_sleep(0.5, stop_event):
        stop_motors(); detach_servos(); return
    # Spin left + claws snap
    drive(-0.9, 0.9)
    set_servos(0, 0)
    if interruptible_sleep(0.5, stop_event):
        stop_motors(); detach_servos(); return
    # Victory forward + claws wide
    drive(0.6, 0.6)
    set_servos(180, 180)
    if interruptible_sleep(0.3, stop_event):
        stop_motors(); detach_servos(); return
    stop_motors()
    detach_servos()


def anim_losing(stop_event: threading.Event):
    """Slow backward retreat. Claws droop closed."""
    drive(-0.25, -0.25)
    set_servos(20, 20)
    if interruptible_sleep(2.0, stop_event):
        stop_motors(); detach_servos(); return
    stop_motors()
    detach_servos()


def anim_celebrating(stop_event: threading.Event):
    """Full energetic dance — spins, charges, pauses — loops until interrupted. Enthusiastic clapping."""
    while not stop_event.is_set():
        # Spin right + claws wide
        drive(1.0, -1.0)
        set_servos(180, 180)
        if interruptible_sleep(0.4, stop_event):
            break
        # Spin left + claws snap
        drive(-1.0, 1.0)
        set_servos(0, 0)
        if interruptible_sleep(0.4, stop_event):
            break
        # Charge forward + claws open
        drive(0.9, 0.9)
        set_servos(150, 150)
        if interruptible_sleep(0.5, stop_event):
            break
        # Pause + claws snap
        stop_motors()
        set_servos(30, 30)
        if interruptible_sleep(0.2, stop_event):
            break
        # Reverse + claws wide sweep
        drive(-0.7, -0.7)
        set_servos(180, 180)
        if interruptible_sleep(0.3, stop_event):
            break
        # Quick spin + claws snap
        drive(0.8, -0.8)
        set_servos(0, 0)
        if interruptible_sleep(0.3, stop_event):
            break
        # Pause + claws open
        stop_motors()
        set_servos(150, 150)
        if interruptible_sleep(0.3, stop_event):
            break
    stop_motors()
    detach_servos()


def anim_dying(stop_event: threading.Event):
    """1s pause, then accelerate forward to full speed for 3s (off the table!)."""
    # Note: dying is a priority override — stop_event is ignored
    stop_motors()
    # Slowly close claws during pause
    set_servos(90, 90)
    time.sleep(0.5)
    set_servos(45, 45)
    time.sleep(0.3)
    set_servos(0, 0)
    time.sleep(0.2)
    # Ramp up with claws closed
    for speed in [0.3, 0.5, 0.7, 1.0]:
        drive(speed, speed)
        time.sleep(0.2)
    # Full speed for remaining time
    drive(1.0, 1.0)
    time.sleep(2.2)
    stop_motors()


def anim_error(stop_event: threading.Event):
    """Immediate hard stop. Claws snap shut."""
    stop_motors()
    set_servos(0, 0)
    detach_servos()


EMOTION_MAP = {
    "idle": anim_idle,
    "listening": anim_listening,
    "thinking": anim_thinking,
    "excited": anim_excited,
    "watching": anim_watching,
    "winning": anim_winning,
    "losing": anim_losing,
    "celebrating": anim_celebrating,
    "dying": anim_dying,
    "error": anim_error,
}


# ── Animation Controller ────────────────────────────────────────────────────

class MotorController:
    def __init__(self):
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._dying = False
        self._lock = threading.Lock()

    def set_emotion(self, emotion: str):
        """Start the animation for the given emotion, stopping any current one."""
        with self._lock:
            # Dying is a priority override — block other emotions
            if self._dying:
                emit_status("blocked", f"dying in progress, ignoring {emotion}")
                return

            if emotion == "dying":
                self._dying = True

            # Stop current animation
            self._stop_event.set()
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=1.0)

            anim_fn = EMOTION_MAP.get(emotion)
            if not anim_fn:
                emit_status("error", f"unknown emotion: {emotion}")
                stop_motors()
                return

            self._stop_event = threading.Event()
            self._thread = threading.Thread(
                target=self._run_animation,
                args=(anim_fn, emotion),
                daemon=True,
            )
            self._thread.start()
            emit_status("emotion_changed", emotion)

    def _run_animation(self, anim_fn, emotion: str):
        try:
            anim_fn(self._stop_event)
        except Exception as e:
            emit_status("error", f"animation {emotion} failed: {e}")
            stop_motors()

    def set_servo_angles(self, angle1: float, angle2: float):
        """Directly set servo angles."""
        set_servos(angle1, angle2)
        emit_status("servos_set", f"{angle1},{angle2}")

    def stop(self):
        """Stop the current animation and motors."""
        with self._lock:
            if self._dying:
                return  # Don't interrupt dying
            self._stop_event.set()
            if self._thread and self._thread.is_alive():
                self._thread.join(timeout=1.0)
            stop_motors()
            emit_status("stopped", "motors stopped")

    def shutdown(self):
        """Stop everything and prepare for exit."""
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        stop_motors()
        detach_servos()
        if not SIMULATION_MODE and SERVO_AVAILABLE:
            pwm_servo_1.stop()
            pwm_servo_2.stop()
            GPIO.cleanup([5, 21])
        if not SIMULATION_MODE and standby:
            standby.off()
        emit_status("shutdown", "motor controller shutting down")


# ── Main Loop ────────────────────────────────────────────────────────────────

def main():
    controller = MotorController()

    # Graceful shutdown on SIGTERM
    def handle_sigterm(signum, frame):
        controller.shutdown()
        sys.exit(0)

    signal.signal(signal.SIGTERM, handle_sigterm)

    mode_msg = "GPIO unavailable - simulation mode" if SIMULATION_MODE else "GPIO active"
    emit_status("ready", mode_msg)

    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue

            try:
                cmd = json.loads(line)
            except json.JSONDecodeError as e:
                emit_status("error", f"invalid JSON: {e}")
                continue

            command = cmd.get("command")

            if command == "set_emotion":
                emotion = cmd.get("emotion", "")
                controller.set_emotion(emotion)
            elif command == "set_servos":
                controller.set_servo_angles(cmd.get("angle1", 90), cmd.get("angle2", 90))
            elif command == "stop":
                controller.stop()
            elif command == "shutdown":
                controller.shutdown()
                break
            else:
                emit_status("error", f"unknown command: {command}")

    except KeyboardInterrupt:
        pass
    finally:
        controller.shutdown()


if __name__ == "__main__":
    main()
