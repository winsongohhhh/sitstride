# SitStride for Windows

A small system-tray app that reminds you to change posture, with a green animated character inspired by the supplied reference image.

## Install and use

1. Run `SitStride-Setup-1.0.7-x64.exe` on 64-bit Windows 10/11. Check **Settings → System → About → System type**. This release cannot run on 32-bit x86 Windows: Electron 45 no longer publishes that runtime. ARM64 is not a native target of this release. No Node.js or Python installation is needed. The installer supports a per-user installation and an uninstall entry in Windows Installed apps.
2. Launch SitStride. Its icon stays in the system tray at the bottom-right, near the clock. Windows may put it under the **^** hidden-icons menu; drag it out if you want it always visible.
3. A fresh **60-minute sitting timer** starts. When it ends, the popup appears near the bottom-right without intentionally taking keyboard focus. The reminder says **“Time to stand up”** and suggests **walking 250 steps**. Click **Stand up** to smoothly animate the figure into a standing pose and start a **5-minute standing timer**.
4. When the standing timer finishes, the app waits for you. Click **Back to sitting** to animate back and begin a fresh sitting countdown. You can return early if needed.

Click **−** in the top-right to minimize to the system tray. The countdown keeps running in the background and the reminder automatically reappears when it ends. Click the tray icon to show or hide the popup. Right-click it for the posture action, Pause/Resume, Settings, and Quit. Click **×** to open **“Close SitStride?”**. Choose **Keep in system tray** to hide the window while reminders continue, or **Quit SitStride** to stop reminders and exit. Escape dismisses this dialog without hiding the app. The **−** button still hides silently without a prompt. You can also stop the app using **Quit SitStride** in the tray menu. Walking 250 steps is a suggestion, not a measured step counter.

## What changed in 1.0.7
- Saved **Reduce motion** now applies to the close dialog as well as the mascot, even when the OS preference is off. Either preference removes spatial movement and uses a short opacity-only dialog fade (120ms in, 100ms out); live OS changes are respected.
- Dialog choices retain 44px-high hit targets, immediate press feedback before release, visible keyboard focus, focus containment, and Escape dismissal with focus restoration.
- The 44px target requirement is scoped to the close-dialog choices. Legacy window/main/settings controls retain their compact sizes; this is not an app-wide 44px claim.
- **Keep in system tray** hides without stopping reminders; **Quit SitStride** exits; **−** minimizes silently. Regression checks cover these separately.
- Versioned x64-only QA candidate, unsigned. Native Windows behavior remains untested. No x86 or ARM64 installer is included.
- New output is under `release/1.0.7/`. Existing 1.0.6 artifacts and evidence are preserved byte-for-byte.
- Checksums: `SitStride-SHA256SUMS-1.0.7.txt`; validation: `SitStride-Validation-1.0.7.json`.

## Previous changes in 1.0.6
- Added the close choice between keeping reminders in the system tray and quitting; minimize remains silent.
- Released x64 only; Electron 45 does not publish Windows ia32 runtime binaries.

## Previous changes in 1.0.5

- Updated the app, installer, uninstaller, shortcuts, and tray to the seated mascot with its chair, matching the animation; the icon has no clock.
- No changes to reminder behavior, compact layout, settings, or current interface copy.
- Versioned checksums: `SitStride-SHA256SUMS-1.0.5.txt`.

## Previous changes in 1.0.4

- Clarified the settings note: “Timing changes apply next phase.” Only timer-duration changes are deferred.
- Release validation now references the exact versioned checksum sidecar, `SitStride-SHA256SUMS-1.0.4.txt`.

## Previous changes in 1.0.3

- Settings now say “Run on startup,” “Reduce motion,” and “Play a reminder sound.”
- Status, settings, and error messages use concise, single-line copy at the standard 320×480 popup size.
- Added automated wrapping checks for the compact interface.

## Previous changes in 1.0.2

- Main-process tests now resolve this package’s own entrypoint relative to the test file, so they work in relocated or extracted checkouts.
- Standing-completion copy says “next sitting interval” rather than assuming a one-hour interval.

## Previous changes in 1.0.1

- Added a dedicated minimize-to-tray button; minimizing or closing keeps the countdown running.
- Due reminders reopen the popup, including after minimizing, and show the reminder even if Settings was open.
- The standing reminder suggests walking **250 steps**, and the standing-break view repeats the suggestion.
- Kept the existing 60-minute sitting / 5-minute standing cycle and smooth posture animation.

## Settings

Choose a sitting interval from 1–240 minutes and a standing interval from 1–60 minutes. Duration changes apply to the **next** posture phase, not the current countdown. There are optional start-with-Windows, reminder sound, and reduced-motion controls. Windows' reduced-motion preference is also respected.

Pause freezes the countdown. A sitting reminder can be snoozed for five minutes. Time spent in system sleep counts toward the active interval, so an overdue reminder appears after the PC wakes. Settings persist locally; quitting and relaunching starts a fresh sitting countdown. Completed-break counts are for the current app session.

## Important notes

This is an **unsigned test build**, not a Microsoft-certified release. Windows may display an unknown-publisher or SmartScreen warning. Only run a copy you trust; the source project is included separately for review or rebuilding. The app makes no network requests and has no automatic updater or telemetry.

The timer, background/minimize lifecycle, and popup have automated regression coverage; the popup has also been tested in a Linux Electron runtime, and the Windows installer has been cross-built. Native Windows installation, tray placement, sound, startup registration, and multi-monitor/DPI behavior still need a Windows smoke test. Treat this as a first test release rather than a fully Windows-validated production release.

Before using this app, stop the old VBS reminder if it is running, to avoid duplicate reminders. The new app does not execute the old `Stop_Timing.vbs`, which terminates every `wscript.exe` process rather than only this reminder.

## Build from source

Use Node.js 22.12 or newer (Node.js 24 recommended) and npm:

```sh
npm ci
npm test
npm start
npm run dist:win
```

The Windows installers are written into `release/1.0.7/`. `npm run dist:win` builds x64. `npm run dist:win:x86` intentionally reports the unsupported architecture instead of attempting to download a missing runtime. Building on Windows is recommended. Linux cross-builds require Wine for the installer toolchain and an X display or `xvfb-run`. The bundled app runtime is Electron; its larger installer size is expected. No development dependencies are included in the installed app.

`app/timer.js` contains the testable timer state machine. `app/main.js` owns the tray, popup, local settings, startup registration, and allowlisted IPC. `app/renderer/` contains the interface and interruptible pose animation. `tests/` contains automated tests.

## Credits and license

Original StandUp Windows script: Copyright (c) 2026 Flora Wu, MIT License. The original license is retained in `app/LICENSE`, and the original scripts are preserved in `original/`. The application/tray icon is bundled in app/assets. New application code is provided under the MIT License.
