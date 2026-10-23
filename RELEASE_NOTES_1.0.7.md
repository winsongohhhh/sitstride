# SitStride 1.0.7 — draft release notes

**Draft only. No GitHub release has been created.**

SitStride is a stand up reminder for Windows that pairs a system-tray sitting timer with standing-break reminders and an animated mascot. Customize your intervals, pause or snooze reminders, and keep the app out of the way in the tray.

## Changes in 1.0.7

- The saved Reduce motion preference now applies to the close dialog as well as the mascot, even when the OS preference is off.
- Either reduced-motion preference removes spatial dialog movement and uses short opacity-only fades (120ms in, 100ms out); live OS changes are respected.
- Close-dialog choices retain 44px-high targets, press feedback, visible keyboard focus, focus containment, and Escape dismissal with focus restoration. This is not an app-wide 44px target claim.
- Keep in system tray continues reminders; Quit SitStride exits; the minimize button hides silently. Regression checks cover these behaviors separately.

## Platform and validation

- Intended target: **Windows 10/11 x64 only**. Electron 45 does not publish Windows x86 runtimes; no native ARM64 installer is included.
- **Unsigned test candidate.** Windows may display unknown-publisher or SmartScreen warnings.
- Supplied QA passed static/source and packaged-Linux checks. **The installer and native behavior have not been tested on Windows.** Installation/uninstallation, tray behavior, sound, startup registration, multi-monitor placement, and DPI handling still need Windows smoke testing.
- This repository contains source and supplied QA evidence, **not installer binaries**. Building with `npm run dist:win` is configured to produce `release/1.0.7/SitStride-Setup-1.0.7-x64.exe`.

## Existing features

Default 60-minute sitting / 5-minute standing intervals; adjustable timers; pause/resume; five-minute snooze for a due sitting reminder; optional sound and startup registration; locally saved settings; reduced motion; animated posture changes; and a suggestion to walk 250 steps. SitStride does not count steps, provide medical advice, or verify that a break was taken.

## Before public distribution

Complete native Windows testing, review signing and distribution, and obtain owner approval for the exact public destination, files, release text, and promotional copy. No public release or promotional publication is authorized by this private source upload.
