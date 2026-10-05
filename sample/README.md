# Labelled YAP sample takes

These are synthetic examples, not a person's camera recording. The audio was generated locally with **Kokoro-82M v1.0, voice af_heart**, using the Apache-2.0 model and kokoro-js 1.2.1. The MP4 picture is already-generated illustrative footage of a **fictional presenter** in a warm study (a short looping clip, not a real person and not lip-synced to the speech), with a small, persistent **Synthetic demo** label burned into every frame.

The sample runs the full loop without a microphone or model account. Your own recording uses camera and microphone media instead.

- `brief.json` and `setup.json`: the sample topic, prepared angles and delivery cues.
- `script.json`: the complete spoken script, intentional restarts and pauses.
- `take1.wav` / `take1.mp4`: about 37 seconds (the `.wav` is the 16 kHz mono narration; the MP4 carries the same narration, the same decoded audio); two restarts, a coffee-wording experiment, acceptance, and a long pause.
- `take2.*`: about 21 seconds; kept coffee greeting, all three points, one restart.
- MP4 metadata: each `.mp4` carries a title that says it is a labelled sample ("YAP labelled sample take N (synthetic voice, not a real recording)"). The title was restored by stream copy (`ffmpeg -c copy -metadata title=...`); frames, audio and durations are byte-for-byte the same packets.
- `*.words.json`: approximate word timing, labelled sample, with voice provenance.
- `*.plan.json`: planted exchange, answer, restart, fast-passage and silence intervals, used by regression tests.

No audience or learning outcome is claimed. The sample stops at the second take; the three-video experiment has no invented result.

## Playback

`npm run replay -- --fast` prints the engine's sample loop. In the app, choose **Try the sample** and follow the visible recording, editing and next-take controls.

## The sample picture

`take1.mp4` and `take2.mp4` (1280x720, 30 fps, H.264 + AAC) are the already-generated illustrative footage `gameday/footage-prep/take1.mp4` and `take2.mp4` of the Bloom project, re-encoded once to add the **Synthetic demo** label. Nothing new was generated for this release. The audio stream was copied unchanged, and the decoded audio matches the earlier sample byte for byte (SHA-256 of the 16 kHz mono PCM: take1 `854ab574fb51…`, take2 `12d38db5f5b7…`); the durations are unchanged (36.97 s and 20.73 s). `take*.wav`, `*.words.json`, `*.plan.json`, `script.json`, `brief.json` and `setup.json` are exactly as before.

The picture's generation record is `evidence/aaa-phase/media/SOURCE.json` in the development workspace: generated with Seedance 2.0 as a fictional presenter from an existing clean reference, not Deth and not a real user (source clip sha256 `9522e07bacf6…`, 8,189,943 bytes). It is not a recording of anyone speaking these words, and it is not a replacement for your own camera: choose **Record** to use your camera and microphone.

The previous sample pictures (script and waveform renders) are kept in the development workspace under `evidence/completion/broll/sample-backup/`.

## Timing and provenance

Speech is generated in punctuation-delimited chunks. Word boundaries are estimated within each chunk in proportion to letter counts; they are not human transcription or Whisper alignment. Checks require at least 90% of words to overlap sounding audio and no words inside planted pauses.

Model and voice: https://huggingface.co/hexgrad/Kokoro-82M

JavaScript implementation: https://github.com/hexgrad/kokoro/tree/main/kokoro.js

The sample model is a build tool only. No Kokoro model, library or model download is needed to run this demo. No Apple system-voice audio is included in the release ZIP.

## Regeneration in the development source

Generate each script chunk once using kokoro-js 1.2.1, model `onnx-community/Kokoro-82M-v1.0-ONNX`, q8 CPU, voice `af_heart`, speed `script.rates[item.rate] / 215` for normal speech and `/ 170` for the deliberately fast opening. Name chunks `take1-1.wav`, etc. Then:

```
YAP_SAMPLE_CHUNKS=/absolute/chunks node tools/make-sample.js
python3 tools/render-sample-video.py
node --test test/sample-coffee.test.js test/replay-coffee.test.js
```

The renderer needs local FFmpeg; Python is only a development tool. The release contains the rendered assets. Historical Phase 1 fixtures remain unchanged in the development repository for reproducible tests; development tests, old fixture audio and generation tools are excluded from the runnable ZIP.

The coffee exchange is exactly: "Hey YAP, let's try 'Grab a coffee' instead of 'Grab a tea.'" The spoken answer is "Yeah, let's do that." The plan preserves `exchange`, `answer`, `restarts`, `fastPassage`, `gaps`, `pauses` and `neverSpoken`. Historical source fixtures are in `test/fixtures/angle-sample/`.

For the rendered synthetic sample, chunks are peak-normalized and measured internal silences are tightened to 80ms. Explicit scripted gaps and words are preserved. This is prepared demo media, not evidence of natural microphone recognition accuracy.

Historical development replay: `node scripts/replay.js --fast --sample-dir test/fixtures/angle-sample`.

The former system-voice distribution question (Q3) is resolved for this release by replacing that audio with the labelled Kokoro-generated media. Historical system-voice fixture audio remains development-only.
