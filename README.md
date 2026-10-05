# YAP

**An AI creative partner, from your first idea to your next take.**

YAP is the creative partner I'm building to help you turn what's in your head into videos that sound like you. Talk through an idea, shape it into talking points, rehearse, record, and assemble an editable cut. The longer-term vision connects your creative choices to audience feedback and experiments, helping you find what works for your voice.

This repository contains a **runnable local prototype** for review. Personalised trained models, shared learning across users and connected audience analytics are roadmap work, not demonstrated capabilities of this build.

## Run it

You need **macOS, Google Chrome, Node.js 18 or newer**, and internet for the first setup. Use **Code → Download ZIP**, unzip it, then double-click **Start YAP.command**. Alternatively, open Terminal in the extracted folder:

```sh
npm run setup
```

Setup installs dependencies inside this folder and opens the app at `http://127.0.0.1:4317`. Nothing is installed globally. If that port is occupied, run `YAP_PORT=4318 npm run setup`. Stop your instance with **Stop YAP.command** or `npm run setup -- --stop`.

For Claude Code, open this folder and ask:

> Read README.md and INSTALL.md, run npm run setup, and show me the local app. Keep the existing source unchanged. Do not configure a paid API or call a model unless I ask.

The bundled sample and manual recording/editing path need no model account or API key. AI conversations use your own local Claude Code connection and allowance. Some optional beat suggestions can fall back to OpenAI if you have configured an API key; details are in [INSTALL.md](INSTALL.md).

## A short review

1. Open **Saved ideas → Try the sample**. The sample presenter, media and review numbers are explicitly synthetic.
2. Follow the sample through recording, inspect the proposed cuts, restore a cut, and export the MP4.
3. Try your own idea and edit its talking points. Rehearse before starting a recording.
4. Record a short take, make a cut, export, and carry an accepted cue into your next take.

Camera/microphone permission is requested by Chrome. Natural wake-word control is experimental; typed controls and the held-key option are available. The full walkthrough, presentation mode and optional AI setup are in [INSTALL.md](INSTALL.md).

## What to assess

| Area | In this prototype | Remaining work |
| --- | --- | --- |
| Ideas and preparation | Editable talking points, camera-first rehearsal, optional AI conversation and accepted changes | Validate with outside users |
| Recording | Camera/microphone capture; optional screen presentation and separate Live UI recording | Broader physical-device and unfamiliar-user testing |
| Editing | Reviewable cuts, trim, original retained, MP4 export; transcript/caption controls and local B-roll | Broad media compatibility and production hardening |
| Review and next take | Labelled sample analytics; own-video transcript/notes; explicit saved trials and cues | Real platform analytics and measured improvement |
| Learning vision | Explicit user-approved preferences and trials | Personalised trained models, cross-user learning and a demonstrated data moat |

A sample loop demonstrates software behaviour. It is not evidence of audience growth, model superiority or a measured improvement in someone's content. This repository is a review build, not a hosted production service.

## Check the code

No model account is needed for the included deterministic review tests:

```sh
npm run test:review
npm run replay -- --fast
```

These tests cover setup boundaries, Node compatibility checks, licences, sample consistency, saved memory/trials, storage, preparation and mocked model endpoints. They are a **selected smoke suite**, not the complete private development regression suite or a replacement for trying the app. The original `npm test` command intentionally refuses to claim a full regression run from this reduced export.

Source layout: `ui/` contains the interface; `server/` the local server and model adapters; `src/engine/` the recording/creative loop; `src/node/` storage and local media operations; `sample/` the synthetic sample; `test/` the selected review tests.

## Data and model use

Ideas and recordings are saved locally in `data/`, which is excluded from Git. Review uploads stay in your browser. Optional AI requests send the relevant text/context to the model connection you configure. Chrome speech recognition may send audio to its provider. Speech alignment downloads a model on first use and then runs locally. See [INSTALL.md](INSTALL.md) for the specific boundaries.

Never commit recordings, API keys, `.env` files or generated local data. No credentials are supplied in this repository.

## Build and credits

Prepared from YAP development revision `220eb8195f31cf31613a6162250c33f47d3b9fe1` on 5 October 2026. This is a fresh source snapshot: private development history and restricted historical test media are excluded. The app source is unchanged; repository documentation, ignore rules and a review-test command have been added.

YAP's existing [MIT licence](LICENSE) is retained. [NOTICE](NOTICE) credits reused teleprompter/editing code and third-party dependencies; [sample/README.md](sample/README.md) documents synthetic media. YAP does not claim to have invented those underlying components.
