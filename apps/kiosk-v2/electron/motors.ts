import { BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

// ── State ────────────────────────────────────────────────────────────────

let motorProcess: ChildProcess | null = null;
let motorReady = false;

// ── Public API ───────────────────────────────────────────────────────────

export function startMotorController(appRoot: string): void {
  const scriptPath = path.join(appRoot, "..", "..", "scripts", "motor_controller.py");
  console.log("[Motors] Starting motor controller:", scriptPath);

  try {
    motorProcess = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    console.error("[Motors] Failed to spawn python3:", err);
    return;
  }

  motorProcess.on("error", (err) => {
    console.error("[Motors] Process error:", err.message);
    motorProcess = null;
    motorReady = false;
  });

  motorProcess.on("exit", (code, signal) => {
    console.log(
      "[Motors] Process exited",
      code != null ? `code=${code}` : "",
      signal ?? "",
    );
    motorProcess = null;
    motorReady = false;
  });

  let stdoutBuf = "";
  motorProcess.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const status = JSON.parse(trimmed) as {
          type: string;
          status: string;
          message: string;
        };
        console.log(`[Motors] Status: ${status.status} ${status.message}`);
        if (status.status === "ready") {
          motorReady = true;
        }
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send("motors:status", status);
        }
      } catch {
        console.log("[Motors] stdout:", trimmed);
      }
    }
  });

  motorProcess.stderr!.on("data", (chunk: Buffer) => {
    console.error("[Motors] stderr:", chunk.toString().trim());
  });
}

export function sendMotorCommand(
  cmd: Record<string, unknown>,
): { ok: boolean; error?: string } {
  if (!motorProcess || !motorProcess.stdin || !motorReady) {
    return { ok: false, error: "Motor controller not ready" };
  }
  try {
    motorProcess.stdin.write(JSON.stringify(cmd) + "\n");
    return { ok: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to send motor command";
    console.error("[Motors] Send error:", message);
    return { ok: false, error: message };
  }
}

export function stopMotorController(): Promise<void> {
  return new Promise((resolve) => {
    if (!motorProcess) {
      resolve();
      return;
    }

    try {
      motorProcess.stdin!.write(
        JSON.stringify({ command: "shutdown" }) + "\n",
      );
    } catch {
      // stdin may already be closed
    }

    const timeout = setTimeout(() => {
      if (motorProcess) {
        console.log("[Motors] Sending SIGTERM after timeout");
        motorProcess.kill("SIGTERM");
      }
      resolve();
    }, 2000);

    motorProcess.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
