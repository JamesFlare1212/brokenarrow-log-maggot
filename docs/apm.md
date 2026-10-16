# Input APM

APM measures foreground keyboard presses and mouse button presses. A held key
counts once until released. Each mouse button down counts once, including side
buttons; releases, pointer movement and wheel events do not count. This metric
does not identify effective game commands, chat, menus or redundant commands.

## Measurement interval

Live battle-loading events trigger capture. The collector starts its monotonic
clock after registering Windows input and foreground notifications. Capture time
includes periods when the game is not focused; those periods add no actions.
Foreground time and the parser's match duration are reported separately.

- Average APM is `totalActions * 60 / captureDurationSec`.
- Current APM counts the most recent 60 completed one-second buckets. It is
  unavailable during the first 60 seconds. Updates have one-second resolution.
- Peak APM is the maximum of those complete rolling windows, updated while
  capture is running. Captures shorter than 60 seconds have no displayed peak.
- Chart columns show actual input counts in fixed capture-minute buckets. A final
  bucket shorter than 60 seconds is marked with an asterisk and a patterned fill.

Enabling monitoring mid-match or resuming a recovered live match creates a new,
explicitly partial capture. Disabling monitoring, replacing the log source,
resetting the session, shutting down or losing the collector interrupts capture.
Missing input is never reconstructed from historical logs or elapsed match time.
Multiple captures of one match remain separate segments.

## Windows collector

`apps/desktop/src/apm/windows-input.cs` runs in a hidden Windows PowerShell 5.1
process using the installed .NET Framework and Windows Forms. Its source is
embedded in the desktop bundle, so packaged applications need no source-tree
files, native Node addon or extra build toolchain. Startup failure is reported as
unavailable; the application does not request elevation or enable a fallback hook.

The helper owns a message-only window, Raw Input registration with
`RIDEV_INPUTSINK | RIDEV_DEVNOTIFY`, and an out-of-context
`SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` callback. It also checks the foreground
window at every counted input. Accepted process names are BrokenArrow and
BrokenArrowBeta, ignoring case, spaces and underscores. Key repeat state is
tracked per device and removed when that device disconnects.

Only cumulative counts for changed one-second buckets, elapsed milliseconds,
foreground milliseconds and focus status cross the process boundary, at most four
periodic batches per second. Individual key codes, text and pointer coordinates
are never sent to Electron or persisted. All durations use monotonic clocks;
wall-clock timestamps are only metadata.

Startup and heartbeat deadlines detect a missing or stalled helper. Shutdown
requests a final aggregate and waits for process closure before persisting the
result. Unexpected exits preserve the last received batch and mark the capture as
interrupted. An unresponsive shutdown is bounded and reported as interrupted.
Closing the parent's input pipe also shuts down the helper.

## Persistence and lifecycle

SQLite stores capture summaries and minute buckets in `apm_captures`, keyed by a
unique capture ID and associated with the parser's stable session ID. Late FIDs,
map names and match durations update that association without restarting capture.
The application checkpoints active capture every five seconds and saves all final
transitions. A crash can therefore lose input after the last checkpoint; at next
startup unfinished records are marked partial and interrupted, using only the
saved duration and counts.

APM start, stop and metadata operations are serialized so rapid log events cannot
mix sessions or race final aggregation. Log resets publish a final APM event.
The APM screen can display the latest 50 stored captures while monitoring is
disabled. Older records remain in SQLite. Deleting a match removes its associated
captures.

## Validation

`tests/apm.test.ts` covers average and rolling metrics, cumulative batches,
monotonic timing, final aggregation, session identity, interruptions, SQLite
recovery and protocol validation. On Windows it also compiles and tests the real
C# input policy and starts/stops the real collector to verify registration and
cleanup. Lifecycle and UI tests cover asynchronous finalization, reset events,
partial captures, saved results and history-load retries.

The native registration test does not simulate a real Broken Arrow foreground
session. Manual game validation is still needed for fullscreen transitions,
device-specific input, high polling-rate mice and compatibility with the game's
runtime environment.
