# YAP

**A first-pass prototype of a communication partner that learns with you.**

YAP is the creative partner I'm building to help you turn what's in your head into something that sounds like you. The vision is that what you learn from a video, a Loom-style recording or a meeting helps you prepare for the next one: better stories, more natural delivery and a strategy that develops with you. It starts with creating videos, with a longer-term path into presentations, meetings, interviews and difficult conversations.

**This is the first pass, not the finished promise.** The runnable local prototype lets reviewers inspect the idea → prepare → record → edit → next-take foundation. Personalised trained models, shared learning across users, connected audience analytics, meeting assistance and an advantage over base frontier models are goals to build and test. They are not demonstrated by this release.

Start with the app, then read the [modular roadmap](ROADMAP.md), [Loom claim map](docs/LOOM_MAP.md) and [claim-by-claim delivery plan](docs/CLAIMS.md). They connect the demo's timestamps to the seven modules, the original four-week plan and the evidence needed before each larger claim can be made.

The demo video: https://www.loom.com/share/fa69dbc3d8f2413a80f135eaf3a472c2

## The modular plan

**Prep → Live → Cut → Publish → Review → Experiments → the next Prep**, with **Coach** supporting preparation and delivery. A shared learning layer will connect the user's choices, predictions and real outcomes across those modules.

The original four-week plan moves from recording/editing, to voice preparation/coaching/publishing, to real analytics/experiments, then outside-user testing. Each module must connect into the same real-video journey. Later work adds evaluated personalisation, opt-in learning across users, and communication beyond content. The roadmap preserves the original target dates and acceptance checks; those dates are planning targets, not evidence of completion or guaranteed releases.

## Start it

1. On GitHub press **Code**, then **Download ZIP**, and unzip it.
2. Double-click **Start YAP.command**.

A Terminal window opens, then YAP opens in Google Chrome. The first start sets YAP up inside its folder and takes about a minute. Later starts take a few seconds. YAP opens on port 4317, or the next free one.

From Terminal, `npm run setup` in the folder does the same, and `npm run setup -- --stop` stops it.

## Three minutes with YAP

1. Press **Watch YAP work**. A sample take plays by itself for about 40 seconds. YAP ticks each beat as the presenter says it and saves a change the presenter asks for out loud as an experiment. Then the take stops and the editor opens with the cut ready. Press **Review this take** there to read what YAP found in it.
2. Type an idea of your own and send it. YAP asks about it, then proposes a format and a few beats.
3. Record it. Open your idea, start recording, and allow the camera and the microphone when Chrome asks.

## Stop it

Double-click **Stop YAP.command**. Your ideas and recordings stay in the YAP folder.

## What it needs

A Mac, Google Chrome, and an internet connection for the first start. YAP installs nothing outside its folder. On a Mac without Node, YAP fetches its own copy of Node into the folder. YAP's coach uses Claude Code when it is on the Mac, and its built-in coach otherwise.

## If macOS blocks the file

macOS stops a downloaded .command file the first time you open it. Press **Done** on the warning. Open **System Settings**, choose **Privacy & Security**, scroll to **Security**, press **Open Anyway** beside "Start YAP.command", and confirm with Touch ID or your password. Then double-click the file again.

Or open Terminal, type `zsh` and a space, drag **Start YAP.command** into the window, and press Return.

## What works today

On 4 Oct, AI judges that had built none of it walked the app against the 25 things the demo video shows, by doing each one on the page with real speech and a camera feed. 22 worked and 3 worked in part. They judged the 21:53 build; this one adds the small repairs made after it.

| Part | What you can do in this build |
| --- | --- |
| Ideas | Type a rough thought. YAP asks one question at a time, suggests a platform and a format from its format library, lays out the structure, and turns it into a few beats you accept one by one. |
| Live | Record with one beat beside the lens. A beat ticks on the timeline when you have said it. Go back and say a beat again. Change the content mid-take without stopping. Set your own wake word. |
| Edit | Stop goes straight to the editor with a cut ready. Retakes, filler words and the best take are tagged, and every cut can be put back. B-roll moments are suggested; add and tag your own clips. Export an MP4, Premiere XML and a Resolve EDL. |
| Coach | Rehearse on camera with nothing saved. Switch each cue on or off. Smile and Slow down cues come from what the camera and microphone pick up. |
| Review | On the labelled sample: five numbers, a retention chart, key moments and one experiment to try. Add your own video for a transcript and notes. |
| Experiments | "Try this" in Review shows up in your next idea and your next take. |

Worked in part, and other known faults:

- The beat card ticks when you finish a beat, then waits on it until you speak again.
- Chrome's speech recognition often hears "YAP" as "yeah", so the spoken wake word is unreliable. Typing the change works, and so does another wake word such as "coach".
- A spoken change that names a beat can land on the wrong beat.
- Most sample ideas and Review cards open the same sample content.
- The cut preview can freeze for about 7 seconds after you add an uploaded B-roll clip.
- Presentation mode, which records your screen with a camera bubble, is in the build but was not part of the judged walk.
- The sample presenter, footage and numbers are synthetic. See [sample/README.md](sample/README.md).

## What is not in this build

Posting to YouTube or Instagram. Real platform numbers. Models trained on your results or on anyone else's. Meetings. These are the plan in [ROADMAP.md](ROADMAP.md), and [docs/CLAIMS.md](docs/CLAIMS.md) gives the evidence each claim needs.

A sample loop demonstrates software behaviour. It is not evidence of audience growth, model superiority or a measured improvement in someone's content. This repository is a review build, not a hosted production service.

## Check the code

No model account is needed for the included review tests:

```sh
npm run test:review
npm run replay -- --fast
```

These 237 tests cover setup boundaries, Node compatibility checks, licences, sample consistency, saved memory and trials, storage, preparation and mocked model endpoints. They are a **selected smoke suite**, not the complete private development regression suite or a replacement for trying the app. The original `npm test` command intentionally refuses to claim a full regression run from this reduced export. The full development suite passed on this build on 4 October 2026 (2,393 tests); it needs fixtures that are not published here, so you cannot rerun it from this repository.

Source layout: `ui/` contains the interface; `server/` the local server and model adapters; `src/engine/` the recording/creative loop; `src/node/` storage and local media operations; `sample/` the synthetic sample; `test/` the selected review tests.

## Your data and model use

Ideas and recordings are saved locally in `data/`, which is excluded from Git. With Claude Code on the Mac, YAP's coach uses your own Claude Code connection and allowance; without it, YAP uses its built-in coach. Chrome speech recognition may send audio to its provider. Word timing uses a Whisper model that runs in the browser. An `OPENAI_API_KEY` is optional and never required.

Never commit recordings, API keys, `.env` files or generated local data. No credentials are supplied in this repository.

## Build and credits

Prepared on 5 October 2026 from YAP development revision `d06535f6e12eee0f0eb623b504ed6bddb38ac0c9` (4 October 2026, 22:37). This is a fresh source snapshot: private development history and restricted historical test media are excluded. The app source is unchanged; repository documentation, ignore rules, a review-test command and the selected tests have been added. The two earlier commits in this repository hold a previous snapshot from a different development branch (revision `220eb81`, 18:13 the same day).

YAP's existing [MIT licence](LICENSE) is retained. [NOTICE](NOTICE) credits reused teleprompter/editing code and third-party dependencies; [sample/README.md](sample/README.md) documents synthetic media. YAP does not claim to have invented those underlying components.
