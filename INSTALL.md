# YAP demo for Jack

**Easiest way:** unzip `yap.zip` and double-click `Start YAP.command` (the one-page guide is `START-HERE.md`). It runs the same `npm run setup` described below, skips the reinstall when the folder is already set up, and shows a plain message if Node, Chrome or the internet is missing. `Stop YAP.command` stops it. macOS may ask you to right-click and choose **Open** once, because the file is not Apple-signed.

Or, with Claude Code: unzip `yap.zip`, open Claude Code in the `yap` folder, and paste:

> Set up YAP from this folder. Run `npm run setup` and show me the address it prints. It installs only inside this folder, starts the local app and opens Google Chrome. If port 4317 is busy, rerun with `YAP_PORT=4318 npm run setup`. Don't change another app. Nothing to connect, no account and no API key is needed for the bundled demo. When I'm done, run `npm run setup -- --stop` from this folder.

Requires a Mac, Node 18 or newer, Google Chrome and internet for the first setup. You can also run `npm run setup` yourself in Terminal. Setup opens http://127.0.0.1:4317/ . Keep the folder: your ideas and recordings are saved in its `data/` directory.

## Try the full sample

1. Press **Saved ideas**, then **Try the sample** in the gallery. In preparation, press **Try the sample take** again.
2. This labelled synthetic recording uses prepared audio and timed words. When Hey YAP opens the coffee experiment, press **Try for 3 videos**, then **Back to recording**. Let the sample finish and press **Stop**.
3. In the editor, inspect the waveform and cuts. Amber **Review cut** intervals stay in the video until you apply them. Click a removed clip to restore it.
4. **Shorten** trims the beginning and end while retaining the original. **Export** renders a real MP4; press the download link. **Next take** shows the saved trial and lets you keep or drop a cue. After the chosen number of finished recordings, the wording check-in lets you keep the new wording or return to the old wording.

## Shape your own idea

Type an idea and send it. Add details, then **Save idea → Confirm idea** (or **Keep exploring** first). YAP preserves your words; it does not invent a conversation on your behalf. Open your saved idea to edit, add, remove or reorder talking points. **Ask YAP for suggestions** is optional and requires a working local Claude Code connection; an unavailable suggestion leaves your existing points intact. Suggestions enter the recording only when you accept them. In a point’s editor, expand **Prepare another angle** to write a **Story** or **Practical tips** alternative. These are optional, up to 500 characters each. A mid-take request selects the exact alternative you prepared; the next-take screen can remember that choice.

## Record your own video

Choose **Create → Just talk**, or prepare a saved idea. The camera-first Rehearsal view lets you move through one beat at a time, use **Edit beats & cues**, and **Talk to YAP** before recording. Nothing is recorded until you press **Start recording**. Allow camera and microphone when asked. Space pauses; **Stop** saves. In ordinary camera mode, only camera and microphone tracks enter the video; on-screen prompts do not. The explicit presentation mode below also records your chosen screen.

For a typed mid-take correction, press **Type a change** and type `give me another angle` or `try the story`; or hold **H** while speaking. A correction selects a prepared angle; it does not generate arbitrary new prose during recording. The correction has already been applied in the finished take. On the next-take screen, **Keep for future takes** carries it into the next take and later takes of this idea; **Finished take only** leaves it in the finished take without carrying it forward. **Remove from future takes** deletes a saved preference without changing the finished recording. Unrelated ideas do not inherit it. For **Just talk**, the preference follows only that recording’s Next take chain. Natural wake-phrase recognition is experimental and can miss “Hey YAP.” Chrome's live speech service may need internet and may send audio to its provider. The recorded video and app data stay in this folder. Post-take word alignment runs locally in the browser after the model's first download. If speech timing is unavailable, the take is saved uncut rather than guessing cuts.

If permission is denied, the page shows **Not recording**. Allow camera and microphone in Chrome, then press **Retry camera and microphone**. If speech is unavailable, expand the notice for details or press **Type a change**; camera and microphone recording can still work.

Export gives a downloadable MP4 with picture and sound. **Shorten** opens start/end controls in seconds of the original recording, with **Use playhead** buttons. Boundaries inside known words are refused. **Reset trim** removes only the start/end trim; other cut decisions remain. Restoring a cut and exporting again includes that interval. The original capture is retained. A changed cut requires a fresh export; an old download cannot silently deliver a different edit.

The server accepts captured files up to 2 GiB. A controlled 150 MB browser recording has passed save, reload, and full MP4 export checks. Captures larger than 128 MiB use the uncut save path without local word alignment. File size depends on camera settings and recording length; this is not a tested maximum duration for every camera.

The current recording pipeline passed a controlled 60-minute Chrome recording with a 10-second pause, a 218 MB save, complete audio/video decode, and full normal-speed playback of the downloaded MP4. Stop-to-editor took 15.9 seconds; export took 55.1 seconds. This used a 640 × 480 controlled camera fixture, not a live human session or a guarantee for every camera. Earlier hour-video loss and upload-size failures remain in the development record. Export refuses to publish a video track that ends materially before the kept timeline, preserving the original and earlier downloads. That integrity check cannot recover footage absent from the source.

## Review a video

Press **Review** in the top bar. The inbox shows sample videos, labelled "Sample videos · Not connected". Open the first card and pick a number to see where it comes from and a prepared reply; **Try this** saves one trial on that video. Every number and reply there is sample data: no model is called and nothing is connected to YouTube or Instagram.

**Add video** brings in a file of your own (MP4, M4V, MOV or WebM, up to 1 GB). It stays in this browser on your Mac and is not uploaded. YAP shows no numbers and no automatic transcript for it; you can paste your own transcript and add a note at a time. **Ask YAP** answers a question from your saved transcript and notes only and says so on the answer: YAP does not watch or listen to the video, and the video itself is never sent. It needs the model connection set up on your machine (Claude Code); without one, your transcript and notes stay as they are.

## Setup details

`npm run setup` runs a locked `npm ci --ignore-scripts` inside this folder, keeping npm's cache/logs in `data/`. It then fetches a local FFmpeg executable and prepares the browser speech runtime. Nothing is installed globally; no Python or Homebrew is used. Runtime and model licences are listed in `NOTICE` and the installed packages. First install needs network access.

To run again: `npm start`. To stop a server started by setup: `npm run setup -- --stop` (or double-click `Stop YAP.command`, which runs the same identity-checked stop). To move your work, move the whole folder including `data/`.

The demo supports the idea, prepare, record, edit, export and next-take journey, with Review, transcript/caption controls and local B-roll insertion. Grow and extra templates remain outside this demo. Automated verification uses controlled camera/microphone devices; a live human microphone session on your Mac is a separate check.

Optional engine check: `npm run replay -- --fast`. The diagnostic engine also supports your own `OPENAI_API_KEY`; it is not required for the app demo and should never be pasted into the page.

Optional beat suggestions request Sonnet through your local Claude Code and can use its allowance. If Claude does not answer and you have configured `OPENAI_API_KEY` in the server environment, the app can try that paid API. Neither connection is required for your own editable points or the bundled sample. An unavailable or older CLI leaves the manual path usable.

If you manually run `npm ci` or reinstall dependencies, follow it with `node scripts/prepare-runtime.js`. Normal `npm run setup` already runs both steps.

## Source and verification

YAP source is supplied under the MIT licence in `LICENSE`; third-party software and sample voice provenance are in `NOTICE` and `sample/README.md`. The runtime ZIP includes the browser walk and shell checks but excludes development-only regression fixtures. `npm test` therefore refuses to claim a regression pass from the runtime ZIP. `npm run replay -- --fast` runs its bundled engine sample; `npm run walk` additionally needs a local Playwright installation specified by `YAP_PLAYWRIGHT`.

## Present Google Slides and record two versions

1. Open **Presentation** from Ideas, or visit `/present`. Enter your own beats and choose **Go Live**.
2. Keep Google Slides open in another Chrome tab or window. At the camera check, continue to Live, then press **Start screen presentation** and select your Slides tab/window in Chrome’s picker.
3. Use **Screen + bubble** and **Full camera** to switch the recorded picture while talking. Your microphone is recorded; computer audio is not. Keep the YAP window alongside Slides to see your beats and controls while you click through your deck.
4. To show how Live works, press **Record Live UI too** and select the **YAP Live tab** in the second picker. This creates a separate file containing the actual cues and controls.
5. **Stop** saves the clean take first, then the Live UI recording. If the UI upload fails, keep the page open and use Retry or download its backup before continuing.
6. In Edit, **Export** downloads the clean MP4. **Download Live UI** downloads the separate WebM; **Download alignment timing** gives its offset for editing. The UI recording starts after the clean take, so alignment is approximate.

Camera and screen permissions are granted through Chrome/macOS. The two-file path has been tested with real Chromium tab capture and controlled camera/microphone inputs; a physical human recording on your Mac remains the final operator check.

## Refine your presentation in Live

During your own recording, choose **Talk to YAP**. Your clean recording pauses while the conversation panel opens; if you are recording the separate Live UI file, that file can keep the discussion. Your camera and chosen screen stay connected.

Type a question, or choose **Speak**, check the recognised words, and **Send**. For example: “Make this point clearer” or “Help me explain why this matters.” YAP receives the current beat, summaries of your other beats, recent recognised speech and the recent conversation. It does not read your Google Slides or speaker notes. Replies use your local Claude Code connection and its allowance; this conversation does not fall back to a paid OpenAI API.

A suggestion stays separate from your original wording. Edit it if needed, then choose **Apply change**, **Dismiss**, or **Undo last change**. **Continue presentation** closes the conversation and returns to the same take. If you had paused before opening the conversation, it stays paused until you resume it. **Read answers aloud** is optional and off initially.

Saved conversation and wording revisions belong to this recording. Keep this page open until you stop and save: restoring saved notes after a reload does not restore an unfinished recording. If YAP is unavailable, your existing wording is retained and you can continue presenting.
