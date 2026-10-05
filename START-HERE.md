# Start here: YAP demo

**Unzip `YAP-Demo.zip`, then double-click `Start YAP.command`.** The first time, it sets YAP up inside this folder and opens it in Google Chrome. Later clicks just open it.

Needs: a Mac, Node.js 18 or newer, Google Chrome, and internet for the first setup. AI replies and Chrome speech recognition also need their services to be reachable. YAP installs nothing outside this folder and never installs Node or Chrome for you. If one is missing, the window says which and what to do.

macOS may say it can't check this file's developer (it isn't Apple-signed). Right-click `Start YAP.command`, choose **Open**, then **Open** again. You only do this once.

When you're finished, double-click `Stop YAP.command`. Keep the folder: your ideas and recordings are saved in its `data/` folder, and starting again keeps them. Imported Review videos and their reminders stay in this Chrome browser; keep using the same address and browser profile.

## Quick test

1. **No accounts, about 5 minutes:** open **Saved ideas**, press **Try the sample**, then open **Settings (···) → Try the sample take** in Rehearsal. Let it run and press **Stop**, then use **Edit** and **Export** to get a real MP4. Everything labelled *sample* is synthetic.
2. **Shape your idea:** type an idea and ask YAP for a structure. With Claude Code signed in, it replies in the conversation. **Use these beats** accepts a suggestion; **Undo** restores your earlier outline. **Edit beats** lets you change the words yourself before preparing a take. You can also save your own words without AI.
3. **Rehearse, then go Live:** preparing your beats opens your camera with one beat and a timeline. Nothing is recording. Use **Previous / Next**, **Edit beats & cues**, or **Talk to YAP** to refine your words. Apply a change explicitly; Undo restores it. Rehearsal edits survive reload in the same browser tab. Press **Start recording** when ready, then allow the microphone in Chrome. Your own recordings contain your real data, not sample footage. During the take, **Talk to YAP** pauses the recording while you discuss or refine the current beat. **Apply change**, **Undo last change**, and **Continue presentation** put you in control. Stop, edit, and export your recording.
4. **Use what you learned:** open **Review**, then **Add video** to bring in your own file. Paste its transcript or notes and ask a question. Keep a useful suggested cue, then choose **Use in next video**. Prepare shows its source and lets you edit or remove the reminder; Live shows it privately for that take.

To present Google Slides, open **Presentation** from the home screen, put your talking points into the flow chart, and choose **Go Live**. Share your Slides tab or screen in the browser picker. During recording, use **Full camera** or **Screen + bubble**. YAP uses the beats you entered; it does not read your Slides automatically.

Camera recording and manual editing work without an AI account. Idea conversations, rehearsal conversations, Live coaching and AI review use Claude Code on your Mac, so those features need Claude Code installed and signed in. Without it, YAP says so and keeps your own words. Live coaching works from what you give it, not from Google Slides or any connected account.

## If it doesn't open

- **Nothing happens or "Node not found":** install Node.js 18+ from https://nodejs.org, then double-click again.
- **"Chrome could not be opened":** install Google Chrome, then double-click again.
- **Setup failed:** check your internet and double-click again. It resumes where it stopped.
- **Port in use:** in Terminal, in this folder, run `YAP_PORT=4318 "./Start YAP.command"`.

Technical notes are in `INSTALL.md`.
