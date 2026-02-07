# Kiosk (Molty)

React + TypeScript + Vite front-end for the Molty robot. Also includes a **server-side OpenClaw ACP client** for proof-of-life and scripting (no browser/UI handshake).

## OpenClaw ACP client (server-side)

Connects to the OpenClaw gateway as an **operator** (non-UI), so no Origin header or Control UI mode is required. Use this from Node for automation or testing.

**Run (Node 18+):**

```bash
cd apps/kiosk
OPENCLAW_GATEWAY_TOKEN=your_secret_token node client.js
```

With a custom text command:

```bash
OPENCLAW_GATEWAY_TOKEN=your_secret_token node client.js "What is the weather?"
```

- Token is read from `OPENCLAW_GATEWAY_TOKEN` and passed in the WebSocket URL query (`?token=...`); it is never logged.
- Gateway URL defaults to `wss://molty.somehow.dev/`; override with `OPENCLAW_GATEWAY_URL` if needed.
- The client performs the gateway handshake (connect.challenge → connect with `mode: "operator"`, `client.id: "molty-acp-client"`), then sends a `status` RPC and a `voice_input`-style text command, and prints all responses.

## Device pairing (Electron kiosk and remote gateway)

When the kiosk connects to a **remote** OpenClaw gateway (e.g. `wss://molty.somehow.dev/`), the gateway requires **device approval** before the connection is accepted. The flow:

1. **Start the kiosk** and click Connect (or it auto-connects). The kiosk sends a connect request with device attestation (signed challenge).
2. The gateway registers the device as **pending** and typically **closes the connection** (e.g. close code 1008) until an operator approves it.
3. **On the machine running the OpenClaw gateway**, run:
   ```bash
   openclaw devices list
   ```
   You’ll see pending devices with a `requestId`.
4. Approve the device:
   ```bash
   openclaw devices approve <requestId>
   ```
   Use the `requestId` from the list (e.g. a UUID).
5. **Connect again from the kiosk.** The device is now approved, so the gateway will respond with `hello-ok` and keep the connection open.

If the gateway returns a `requestId` in the response or close reason, the kiosk UI will show the exact `openclaw devices approve <requestId>` command. Otherwise use `openclaw devices list` to get the `requestId`.

**If `openclaw devices list` shows no pending devices:**

- The gateway may be closing the connection **before** creating a pending request (e.g. if it rejects the connect as invalid). Try **minimal device mode** so the gateway may register a pending entry:
  - In `apps/kiosk/.env` add: `OPENCLAW_DEVICE_MINIMAL=1`
  - Restart the kiosk, connect again, then on the gateway server run `openclaw devices list` again.
- On the **gateway server**, run `openclaw logs --follow` while the kiosk connects. The logs usually show why the connection was closed (e.g. "pairing required", "invalid signature", "device not found").
- Ensure the kiosk and the CLI use the **same gateway URL and token** (same `OPENCLAW_GATEWAY_URL` / `OPENCLAW_GATEWAY_TOKEN` as on the server or `--url` / `--token` when running `openclaw devices list`).

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from "eslint-plugin-react-x";
import reactDom from "eslint-plugin-react-dom";

export default defineConfig([
  globalIgnores(["dist"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs["recommended-typescript"],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.node.json", "./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
]);
```
