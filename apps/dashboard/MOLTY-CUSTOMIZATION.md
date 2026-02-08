# Molty dashboard customization & avatar strategy

## 1. How the kiosk “face” works today

- **`apps/kiosk/src/components/MoltyFace.tsx`**  
  Single component: takes `expression` (`FaceExpression`), `isTalking`, optional `subtitle`. Renders a CSS face (eyes + mouth + background) that changes with expression.

- **Expressions** (from `types.d.ts`):  
  `idle` | `listening` | `thinking` | `excited` | `watching` | `winning` | `losing` | `celebrating` | `dying` | `error`

- **Driver**: `useMoltyState` updates `face` from agent text (e.g. `[face:winning]`) and voice state. So the kiosk always renders **one** avatar component (currently the face) and only the expression changes.

- **Styling**: `MoltyFace.css` — one face design, many `.face-{expression}` overrides (colors, pupil position, mouth shape).

So today: **one avatar type (face)**; switching expression is already supported. What’s missing is **switching avatar type** (face vs dinosaur vs aura, etc.).

---

## 2. How to support “face / dinosaur / aura” and keep it customizable

### Idea: one “Molty config” that both dashboard and kiosk use

- **Avatar type**: `face` | `dinosaur` | `aura` (or more later).
- **Dashboard**: uses it for branding (logo, optional avatar on home). For **demo** you keep `face`; no need to implement dinosaur/aura in the dashboard.
- **Kiosk (Electron)**: reads the same config and **renders the right avatar component**:
  - `face` → existing `<MoltyFace />`
  - `dinosaur` → `<MoltyDinosaur />` (new, same `expression` + `isTalking` + `subtitle` props)
  - `aura` → `<MoltyAura />` (new)

So: **same API (expression, isTalking, subtitle)**; only the visual component changes by type.

### Where to store the config

**Option A – Env (simplest for now)**  
- Dashboard: `NEXT_PUBLIC_MOLTY_APP_NAME`, `NEXT_PUBLIC_MOLTY_LOGO_URL`, `NEXT_PUBLIC_MOLTY_AVATAR_TYPE` (optional; dashboard might only use name + logo).  
- Kiosk: `VITE_MOLTY_AVATAR_TYPE=face` | `dinosaur` | `aura`.  
- Build-time only; change requires rebuild/redeploy.

**Option B – API from backend**  
- Backend exposes `GET /api/config` or `GET /api/molty` returning `{ appName, logoUrl, avatarType }`.  
- Dashboard and kiosk fetch on load. No rebuild to change avatar type or logo.

**Option C – Dashboard as source of truth**  
- Dashboard has a “Molty settings” page (or Settings → Molty): form to set app name, logo URL, avatar type. Saves to backend or DB.  
- Kiosk fetches config from same backend (or from dashboard’s API).  
- Best for “we customize it per deployment” without touching env.

For **demo**: Option A is enough — dashboard and kiosk read from env; **avatar type = face** in both. In Electron you later set `VITE_MOLTY_AVATAR_TYPE=dinosaur` (or `aura`) and add the corresponding components.

### Implementation steps (high level)

1. **Shared “Molty config” shape** (types or a small shared package):  
   `appName`, `logoUrl?`, `avatarType: 'face' | 'dinosaur' | 'aura'`, optional `primaryColor`, etc.

2. **Dashboard**  
   - Read `NEXT_PUBLIC_MOLTY_APP_NAME` (default `"Molty"`), `NEXT_PUBLIC_MOLTY_LOGO_URL` (optional).  
   - **Sidebar**: if `logoUrl` is set, show `<img src={logoUrl} alt={appName} />`; else show text “Molty” (or `appName`).  
   - **Home (optional)**: small “Molty” hero with an avatar placeholder — for demo use the **face** (e.g. static image or a minimal CSS face that doesn’t depend on voice). So dashboard is “per Molty” and you can swap logo/name without code changes.

3. **Kiosk**  
   - Read `VITE_MOLTY_AVATAR_TYPE` (default `face`).  
   - In `App.tsx`:  
     `avatarType === 'face'` → `<MoltyFace ... />`  
     `avatarType === 'dinosaur'` → `<MoltyDinosaur ... />` (new)  
     `avatarType === 'aura'` → `<MoltyAura ... />` (new)  
   - Each avatar component receives the same props: `expression`, `isTalking`, `subtitle`.  
   - For **demo** you only use `face`; dinosaur/aura are added when you’re ready.

4. **Avatar components in kiosk**  
   - `MoltyFace` – existing.  
   - `MoltyDinosaur` – new; same prop interface; different visuals (e.g. SVG or CSS “dinosaur” that reacts to expression).  
   - `MoltyAura` – new; same prop interface; e.g. particle/glow that changes with expression.  

So: **dashboard** = customize name + logo (+ optional “face” for demo). **Kiosk** = choose which avatar to show via config; for demo it’s face; in Electron you can switch to dinosaur/aura when those components exist.

---

## 3. What should ideally be in the dashboard

Things that fit “Molty” and prediction markets and are good to have in the dashboard:

| Area | What | Why |
|------|------|-----|
| **Branding** | App name + logo (configurable via env or settings) | So the dashboard is clearly “Molty” and can be rebranded. |
| **Home** | Optional Molty avatar (e.g. static face for demo) | Makes it feel like the same product as the kiosk; can be hidden or swapped later. |
| **Markets** | List, filters (All / Open / Resolved), Create market, Resolve | Already there; core. |
| **Predictions** | List of all predictions (question, direction, outcome) | Already there. |
| **Transactions** | Yellow custody deposits/withdrawals, chain filter, wallet filter | Already there. |
| **Settings / Molty** | Page or section: app name, logo URL, avatar type (for kiosks that pull config) | Optional but useful so operators don’t touch env. |
| **Custody / on-chain** | Total in custody, total volume (from contract or API) | Single numbers on dashboard home. |
| **Kiosks** (later) | List of kiosks that use this backend, online/offline | Only if kiosks register with the same backend. |
| **Docs / help** | Link to internal docs or “How to create market” | Reduces support. |

**Already there:** sidebar, markets, predictions, transactions, create/resolve, wallet connect.  
**Add for “Molty” and customization:** config-driven name + logo in sidebar, optional avatar on home, optional Settings/Molty page and (later) kiosk list and custody totals.

---

## 4. Summary

- **Avatar (face vs dinosaur vs aura)**  
  - Driven by a single **avatar type** in config (env or API).  
  - Kiosk renders one of: `MoltyFace`, `MoltyDinosaur`, `MoltyAura` (same props).  
  - For **demo** use **face** everywhere; in the Electron app you switch to dinosaur/aura when those components exist.

- **Dashboard “as per Molty”**  
  - Use a small **Molty config** (app name, logo URL, optional avatar type).  
  - Sidebar shows logo or “Molty” text from config.  
  - Optional: home hero with a static/demo face so the dashboard feels like Molty.

- **Ideally in the dashboard**  
  - Branding (name + logo), markets, predictions, transactions (done).  
  - Optional: Settings/Molty page, custody/volume summary, kiosk list, docs link.
