# Recording codecs and quality

BARadar records the selected display using Electron desktop capture. The capture
page encodes MediaStream tracks with WebCodecs and uses Mediabunny 1.65.1 to write
fragmented MP4. This replaces the VP8 MediaRecorder encoder; it does not introduce
a native Windows capture service or a bundled FFmpeg executable.

## Encoder selection

Before each recording, probe AV1, HEVC, then H.264 with `prefer-hardware`. Each
probe uses the requested output dimensions, frame rate and quantizer, encodes
three synthetic frames, finalizes the output, and decodes the first packet.
An unsupported configuration, encoder initialization error, missing output,
playback failure or five-second timeout advances to the next candidate. After
these three attempts, software AV1 is the only software fallback. Software
encoding is attempted only after all three hardware-preferred candidates fail.

Hardware acceleration is a WebCodecs preference, not proof of NVENC, AMF or QSV
usage. Chromium selects the underlying implementation. Capability checks are
performed for each recording because displays, drivers, requested dimensions and
available encoder sessions can change. Cancellation stops further probes.

The encoder must support quantizer mode. No fixed video bitrate or VP8 fallback
is supplied. If all candidates fail, the recording reports an error suggesting
a lower resolution or frame rate. A failure after recording starts ends that
attempt; codecs are never changed inside an existing MP4 track.

## Quality parameters and sources

The quality score is an integer from 1 to 51, with 20 as the application default.
Lower numbers request higher quality and generally produce larger files. The
existing `replayQuality` setting continues to represent resolution; the new
`replayQualityScore` setting replaces `replayBitrateMbps`.

The [OBS Advanced Recording Settings Guide](https://obsproject.com/kb/advanced-recording-settings-guide)
recommends 16–23 as a starting range for NVENC Constant QP, AMD CQP, Intel ICQ
and x264 CRF, and a two-second keyframe interval. These are recommendations from
OBS for its named encoders, not an official WebCodecs quality preset. BARadar
uses the range as UI guidance and chooses 20 as its default. It does not claim
to implement ICQ/CRF, reproduce OBS encoder presets, or provide equal visual
quality across different codecs and devices.

The actual WebCodecs control is a per-frame quantizer:

| Codec | Application score | Value sent to WebCodecs | Specification range |
| ----- | ----------------- | ----------------------- | ------------------- |
| H.264 | 20                | AVC QP 20               | 0–51                |
| HEVC  | 20                | HEVC QP 20              | 0–51                |
| AV1   | 20                | AV1 qindex 80           | 0–255               |

AV1 uses four times the application score; this is an application mapping to its
different qindex scale, not a perceptual equivalence formula. All three encoders
use realtime latency and a two-second keyframe interval. Audio is AAC at a target
128 kbit/s. The two-source mixer uses 48 kHz stereo; a single source retains its
capture sample rate and channel count. The video quality score does not change
audio bitrate.

Authoritative API references:

- [W3C AVC quantizer](https://w3c.github.io/webcodecs/avc_codec_registration.html#videoencoderencodeoptionsforavc)
- [W3C HEVC quantizer](https://w3c.github.io/webcodecs/hevc_codec_registration.html#videoencoderencodeoptionsforhevc)
- [W3C AV1 quantizer](https://w3c.github.io/webcodecs/av1_codec_registration.html#videoencoderencodeoptionsforav1)
- [Mediabunny encoding](https://mediabunny.dev/guide/encoding)

## Capture, persistence and migration

The encoder consumes the captured video track directly; there is no application
Canvas redraw timer on the encoding path. Mediabunny handles scaling when output
dimensions differ and bounds its encoder queue. The once-per-second preview
still uses a small Canvas. Output dimensions are rounded to an even width for
chroma-subsampled encoders. Resolution and frame rate retain their previous
ranges: 720p–2160p and 30–120 FPS.

System audio and the optional default microphone retain their existing capture
and mixing behavior. AAC is warmed up with synthetic silence before live encoding.
Live audio is passed directly to the encoder instead of the library's buffered
offline resampler. MediaStream sources share a timestamp origin. The recorder
reports readiness only after video and any enabled audio have produced packets.
Finalization drains the encoders, MP4 fragments and sequential acknowledged IPC
writes before the main process renames the temporary file. Both live sources are
paused before either encoder is flushed. Fragments have a
minimum duration of two seconds, and IPC writes are at most 1 MiB each.

New recordings are `.mp4`. The library, deletion, folder migration and Range
playback also retain support for existing `.webm` recordings. MP4 playback uses
`video/mp4`; WebM uses `video/webm`. Temporary files remain hidden. Fragmentation
reduces dependence on a final monolithic metadata write, but automatic recovery
of recordings interrupted by an application crash is not implemented.

Legacy bitrate settings have no reliable conversion to constant quality. Opening
an old database or importing legacy JSON starts at quality score 20 while
preserving resolution, frame rate, audio and other preferences. The obsolete
bitrate field is dropped when preferences are next saved. Fixed-duration file
size estimates are removed because quality-driven file size depends on content.

## Validation

`pnpm check`, `pnpm format:check`, `pnpm smoke` and `pnpm smoke:real` cover the
application and existing offline data. `pnpm smoke:recording` additionally uses
the built recorder and sandboxed preload to record synthetic video and two audio
tones, inspect the actual WebCodecs quantizer options, save MP4 and verify decoded
playback and seeking. It captures no real display or microphone content.

Use `node scripts/recording-smoke.mjs --codec=hevc` or `--codec=h264` after building
to simulate unavailable higher-priority encoders and exercise fallback. These
tests still use real encoders; actual support depends on the machine. Artifacts
are saved under the ignored `.test-data/recording-smoke/` directory. Synthetic
smoke tests do not measure game frame-time impact or validate every GPU driver.
Use `--codec=software-av1` to reject hardware-preferred configurations and verify
that the final fallback requests software AV1 and produces playable MP4.
