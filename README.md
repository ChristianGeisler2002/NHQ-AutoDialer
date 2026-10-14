# NHQ AutoDialer

I built NHQ AutoDialer to work through a lead list, make one call at a time, and save the outcome to a local Excel tracker. Each call starts with a click. Ending a call opens the log; the app does not dial the next lead automatically.

## Stack and choices

| Part | Technology | Reason |
| --- | --- | --- |
| Desktop | Electron 44 | Provides a Windows app with file dialogs, local storage, and microphone access. |
| Interface | React 18, TypeScript, HTML, CSS | Keeps the dialer, queue, settings, and post-call form as separate components with shared types. |
| Build | electron-vite, Vite, electron-builder | Builds the main process, preload bridge, and renderer, then packages Windows releases. |
| Data | SQLite through sql.js/WebAssembly | Stores leads, calls, settings, and Do Not Call entries without a native database compiler. |
| Spreadsheets | ExcelJS | Reads leads and appends call logs while keeping workbook sheets and formatting. |
| Lead archives | adm-zip | Reads spreadsheets inside ZIP archives without extracting customer files into the source. |
| Phone handling | libphonenumber-js | Normalizes numbers to E.164 for deduplication and Do Not Call checks. |
| Real calls | Telnyx WebRTC SDK | Uses a SIP connection for browser-based audio without a separate token server. |
| Private settings | Electron safeStorage | Encrypts SIP credentials and caller ID with the operating system before saving them. |
| Tests | Node assert, esbuild, Electron | Exercises storage, import, tracker writes, calling checks, and provider events. |

TypeScript is used in the app, TSX in the React screens, CSS for styling, SQL for storage, and small JavaScript scripts for builds and tests. The calling provider is separate from the UI so Mock mode and Telnyx use the same call flow.

## Run locally

Use Node.js 22.12 or newer; Node 24 is the tested environment.

```powershell
npm ci
npm run dev
```

Start with **Mock** mode. In **Setup / Import**, choose **Load sample leads**, then open the dialer. These fictional contacts use reserved example numbers and cannot be called through Telnyx. The app creates a blank tracker; no customer workbook is bundled.

For your own leads, select ZIP archives containing `.xlsx` workbooks. Use headers such as Business, Owner, Phone, Website, Location, and Revenue. Industry and country are inferred from the workbook filename. Numbers are normalized and duplicate valid numbers are skipped. Invalid numbers remain visible for review but cannot be dialed.

## Calling and logging

1. Select a lead and click **Call**.
2. Use **Mute** or **Hang Up** during the call.
3. Fill in the post-call outcome and notes.
4. Save the log to SQLite and the Excel tracker.
5. Click **Next Call** when ready.

Call-log retries reuse the same submission ID to avoid duplicate records and tracker rows. If Excel has locked the workbook, close it and retry the save. A tracker backup is created before each write. An unsupported workbook layout is refused instead of being overwritten.

Do Not Call checks run before dialing. Formatted versions of the same number use the same normalized entry. Removing an entry explicitly makes the affected leads available again. Optional calling hours use a state/province timezone estimate; some regions have more than one timezone, so this is not an exact location lookup.

## APIs and private configuration

This app has no hosted REST server. React calls the main process through the typed preload API in `src/shared/api.ts`. The main process handles lead import, queue filters, settings, Do Not Call, call logs, file dialogs, and tracker operations. Electron IPC requests are restricted to the app's main window.

**Telnyx is the only external calling integration.** For live calls, use a Telnyx credential-based SIP connection with an outbound voice profile and an authorized caller ID. Enter the SIP username, password, and caller ID in **Settings**, then save and connect. Allow desktop microphone access in Windows settings. A Telnyx account and calling credit are required.

No Telnyx REST API key is required by this version. The SDK handles WebRTC signaling and media. Credentials and caller IDs are entered at runtime, encrypted on disk, and held in memory while connecting. Raw provider errors and credentials are not logged by the app. The source contains the integration and configuration field names, with no personal numbers, lead archives, call history, or live credentials.

Provider setup references: [Telnyx WebRTC guide](https://developers.telnyx.com/development/webrtc/js-sdk/quickstart/index), [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).

## Project layout

```text
src/main/                 Desktop startup, SQLite, settings, IPC handlers
src/main/services/        Lead import, phone/location handling, Excel tracker
src/preload/              Typed bridge between React and Electron
src/renderer/src/         Screens, styling, shared call state
src/renderer/src/services/callingProvider/
                          Mock and Telnyx adapters
src/shared/               API contract and shared data types
scripts/                  Blank tracker generator and test runner
tests/                    Isolated integration tests with fictional records
```

## Data, tests, and Windows build

User data stays in Electron's `userData` folder, shown in Settings. On Windows this normally lives under `%APPDATA%`. It contains the SQLite database, working tracker, and tracker backups. Keep this folder private. Close the app before backing it up. `NHQ_AUTODIALER_DATA_DIR` selects a separate workspace for testing or demos.

```powershell
npm run typecheck
npm test
npm run build
npm run build:unpack
npm run build:win
npm audit
```

Windows builds go to `release/`. The repository contains the source, not generated installers. The blank tracker is generated from `scripts/create-tracker.cjs` during install/build. Lead files, workbooks, databases, environment files, credentials, dependencies, and generated builds are excluded from Git.

The 14 integration checks pass. The packaged Windows executable was also tested through launch, a Mock call and hangup, a failed tracker save and retry, one saved/exported record, Do Not Call, restart persistence, and shutdown. Type checks, production builds, and dependency audits pass. Both full and production dependency audits report zero known vulnerabilities at verification time.

Live Telnyx calls and microphone/audio quality require private credentials and have not been verified with a paid account. Windows packages are unsigned; macOS and Linux packages have not been verified.
