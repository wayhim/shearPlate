# ShearPlate

[English](./README.md) | [简体中文](./README.zh-CN.md)

ShearPlate is a clipboard manager built with Electron, React, and TypeScript. It runs primarily as a tray app, captures clipboard history locally, and lets you quickly search, preview, copy, and paste recent items back into the active input target.

Current version: `0.1.2`

## What It Does

- Records clipboard history for text, images, and files
- Keeps running in the system tray instead of quitting when the window closes
- Opens with a global shortcut: default is `Alt+V`
- Supports search, starred items, and custom snippets
- Stores data locally in SQLite via `sql.js`
- Supports light mode, dark mode, and system theme
- Includes single-instance protection to avoid duplicate app processes
- Includes a restart script for local development and packaging flow

## Status

This repository is currently a local-first clipboard tool. The data model already contains some device-related fields, but the current app behavior is still single-device and local-only. Cross-device sync is not part of `0.1.2`.

## Tech Stack

- Electron 33
- React 18
- TypeScript
- `electron-vite`
- Tailwind CSS
- Zustand
- `sql.js`
- `@tanstack/react-virtual`

## Main Features

### Clipboard Capture

The app polls the system clipboard and persists new items into a local database.

- Text content is stored as searchable clipboard history
- Images can be previewed and materialized into local files when needed
- File copies are tracked with metadata such as path and size
- Duplicate clipboard entries are reduced with content hashing and dedupe logic

### Fast Recall

ShearPlate is designed for quick retrieval instead of acting like a full notes app.

- Filter by content type
- Search clipboard history
- Star important items
- Promote items into reusable snippets

### Paste Relay

When you choose an item from the panel, ShearPlate can write it to the clipboard and attempt to paste it back into the previous active app.

- macOS uses AppleScript/System Events
- Windows uses foreground window targeting plus simulated `Ctrl+V`
- On macOS, this requires Accessibility permission and sometimes Automation permission

### Tray-First Behavior

The app is built to stay out of the Dock/taskbar flow as much as possible.

- Closing the window hides the panel
- The tray icon remains active
- The app can be reopened through the tray or the global shortcut

## Project Structure

```text
src/
  main/                 Electron main process
    clipboard/          Clipboard watcher and paste relay
    store/              SQLite persistence and settings
    system/             Preview and file/image system helpers
  preload/              Secure renderer bridge
  renderer/             React UI
  shared/               Shared types and layout constants
docs/
  MANUAL.md             User-facing manual
scripts/
  restart-app.sh        Local rebuild + restart helper
resources/
  icons and packaging resources
```

## Local Data

Clipboard data is stored locally only.

- macOS: `~/Library/Application Support/shear-plate/shearplate.db`
- Windows: `%APPDATA%/shear-plate/shearplate.db`
- Linux: `~/.config/shear-plate/shearplate.db`

The app does not require a separate database service.

## Requirements

- Node.js 20+ recommended
- `npm`
- macOS or Windows for the currently maintained desktop behavior

Linux is not the main target of the current packaging flow even though some runtime paths exist.

## Getting Started

```bash
git clone https://github.com/wayhim/shearPlate.git
cd shear_plate
npm install
npm run dev
```

For local production build output:

```bash
npm run build
```

## Available Scripts

```bash
npm run dev          # Start Electron in development mode
npm run build        # Build main, preload, and renderer bundles
npm run preview      # Preview production renderer build
npm run typecheck    # Run TypeScript checks
npm run dist:mac     # Build signed + notarized macOS dmg + zip artifacts
npm run dist:mac:unsigned # Build unsigned local macOS artifacts (not for distribution)
npm run dist:mac:dir # Build unpacked macOS .app bundle
npm run dist:win     # Build Windows portable artifact
npm run restart:app  # Rebuild and restart the app locally
```

## Install on macOS

For stable permissions and a predictable app identity, use the packaged app from `/Applications` instead of repeatedly launching from temporary build paths.

Typical local flow:

```bash
npm run dist:mac:dir
open release/mac-arm64/ShearPlate.app
```

If you want the app to behave like a normal installed app, copy `release/mac-arm64/ShearPlate.app` into `/Applications/ShearPlate.app` and launch that version.

If macOS reports the app is damaged, you can remove the quarantine flag as a temporary workaround.

```bash
# Move the app to Applications first
xattr -dr com.apple.quarantine /Applications/ShearPlate.app
open /Applications/ShearPlate.app
```

## macOS Permissions

Automatic paste-back into the previous app depends on macOS permissions.

You may need to allow:

- `ShearPlate` under `System Settings -> Privacy & Security -> Accessibility`
- `ShearPlate` under `System Settings -> Privacy & Security -> Automation`
- `System Events` control if macOS prompts for it

If these permissions are missing, clipboard history still works, but automatic paste relay can fail.

## Signed macOS Release (Required for Distribution)

Unsigned macOS apps can be flagged as “damaged” by Gatekeeper after download. This project now treats signed + notarized builds as the default release path.

1. Install a valid `Developer ID Application` certificate into your macOS keychain.
2. Set notarization credentials with one of these methods:

```bash
# Option A: App Store Connect API key
export APPLE_API_KEY="/absolute/path/AuthKey_XXXXXX.p8"
export APPLE_API_KEY_ID="XXXXXX"
export APPLE_API_ISSUER="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"

# Option B: Apple ID + app-specific password
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID1234"
```

Optional signing selector:

```bash
export CSC_NAME="Developer ID Application: Your Name (TEAMID1234)"
```

Build release artifacts:

```bash
npm run dist:mac
```

The release script validates:

- code signature (`codesign --verify`)
- Gatekeeper assessment (`spctl --assess`)
- notarization stapling (`xcrun stapler validate`)

## Packaging Notes

- macOS artifacts are written to `release/`
- The app is configured as `LSUIElement`, so it behaves like a tray/menu-bar utility
- `npm run dist:mac` now requires signing + notarization credentials and fails fast if missing
- Windows packaging currently targets a portable build

## Development Notes

- The app is single-instance protected in the Electron main process
- A local restart helper exists at `scripts/restart-app.sh`
- Runtime logs and PID files used by the restart helper are kept under `.runtime/`
- The repository may contain a local `arboard` gitlink state; treat unrelated changes there carefully

## Troubleshooting

### The app records clipboard items but does not paste them back

Usually this is a macOS permission issue.

Check:

- Accessibility permission is enabled
- Automation permission is enabled if prompted
- You are launching the installed app path consistently instead of switching between multiple app bundles

### The shortcut does not work

Another application may already be using the same shortcut. The app falls back cautiously, but global shortcuts can still be blocked by the OS or other apps.

### The window closes but the app is still running

This is expected. ShearPlate is tray-first; closing the panel hides it instead of quitting.

## Documentation

- User manual: `docs/MANUAL.md`

## License

No license file is currently defined in the repository root. Add one before distributing the project more broadly.
