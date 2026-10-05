# The promise, current evidence and what must come next

**First-pass prototype — 5 October 2026.** This ledger separates the intended product from what the supplied build demonstrates. It covers the broad claims in Deth's community explanation, including the long-term vision beyond video creation.

The repository's 237 selected deterministic checks and offline replay demonstrate specific software behaviour. They do not measure audience growth, personal development, model superiority, commercial readiness or replacement of entire competing products. “Current evidence” below describes source-supported behaviour and these limited checks; it is not a completed human walkthrough of every feature. The [Loom map](LOOM_MAP.md) supplies timestamps and highlights unverified paths.

| Claim / ambition | Current evidence and limits | Work and evidence needed before a stronger statement |
| --- | --- | --- |
| **Every video, Loom or meeting makes the next one better.** | Accepted cues and explicit trials can persist into later takes. Sample Review numbers illustrate the flow. Meetings and real platform analytics are not implemented here. | Link actual sessions, interventions and outcomes; compare successive sessions against an appropriate baseline. Report uncertainty and failures. The literal guarantee that every session improves is too strong: the testable promise is that every permitted session can inform the next recommendation. |
| **Freedom to flow while keeping your own voice.** | Editable beats, rehearsal, optional conversation and suggestions you accept one at a time preserve user choice. | Test unscripted use, correction latency, interrupt/resume, missed speech and recovery with real users. Compare distraction, effort and user-rated voice fidelity against their normal workflow. |
| **Become a better storyteller and communicator.** | Tools for preparation, cues and review; no measured improvement in human skill. | Repeated practice with independent, blinded assessment on predefined communication tasks. Test retention and performance without YAP's prompts, alongside user feedback, so an assisted take is not confused with a learned skill. |
| **Improve interviews, presentations and difficult conversations.** | A broader intended use of the future coaching system; the current prototype centres on video creation and presentation recording. | Build context-specific rehearsal and user-controlled feedback, then validate with intended users. Evaluate clarity, listening and self-reported usefulness; do not promise a job offer, relationship outcome or ability to infer another person's feelings. |
| **A personal strategy that compounds through data-driven experimentation.** | Saved preferences, named trials and keep/revert choices. No measured compounding advantage. | Record a hypothesis and prediction before an intervention; obtain traceable outcomes; carry the result into the next recommendation. Compare against no-memory and no-experiment versions, including negative/inconclusive results. |
| **Proprietary models, ontology and a data moat.** | The current build combines credited components and optional existing model connections. It does not ship a proven proprietary trained-model advantage. | Establish data rights and a useful structured representation; gather suitable training/evaluation data; test personal/shared learning against baselines. Show sustained performance gains that survive ablation, new users and a reproduction attempt. Ownership of a dataset or custom schema alone does not prove a moat. |
| **Outperform base frontier models.** | Not established. Optional model-backed features do not establish superiority over their underlying models. | Define specific tasks and outcomes; compare against named/versioned base models with strong prompts, equivalent context/tool access and reported resource budgets. Use unseen data and independent evaluation; report cost, latency, variance, losses and failure cases. Claim only the advantage actually measured. |
| **Take content creation from days or hours into minutes.** | An ambition stated around 03:28 in the Loom; no measured time saving in this release. | Time real users from idea to usable export against their usual workflow on comparable tasks. Include setup, corrections, failed runs and output quality. Publish the actual times, sample size and differences; the Week 4 five-user check is an initial usability sample, not proof of a general speed claim. |
| **Replace a teleprompter, scripting chats and a first-pass editor.** | Parts of these workflows are integrated: idea/beat preparation, prompting, recording and reversible editing/export. Some assistance still uses the reviewer's Claude Code connection. | Run task-level comparisons for supported formats with real users. Measure completion, manual effort, output quality and reliability. Include account/model dependencies; do not imply all features of every scripting or editing tool are covered. |
| **Replace Loom.** | Local camera/screen recording and export cover part of the recording job. | Add and validate the required sharing, hosting, permissions, playback, comments and team workflows for a defined user segment. State which use case is replaced rather than claiming full product parity. |
| **Replace Fireflies.** | Meeting attendance, integrations, diarisation, meeting summaries and action workflows are not implemented in this review build. | Build and test permissioned meeting capture/import, accurate speaker-attributed transcripts, summaries and actions, integrations, access controls and deletion. Compare against the specific meeting workflow being replaced. |
| **Replace a speaking coach / work for anyone who speaks.** | Optional coaching interaction and selected cues form an early assistive tool. Broad population coverage is untested. | Assess usefulness across languages, accents, abilities and contexts, with accessible controls and appropriate human feedback. Demonstrate the tasks YAP can assist; do not equate automatic cues with all the judgment or support of a human coach. |

## A benchmark another reviewer can rerun

At approximately **05:31** in the [demo](https://www.loom.com/share/fa69dbc3d8f2413a80f135eaf3a472c2), the wording is “We want to outperform the frontier models.” That is the ambition. The ontology, aggregate learning and personal-model discussion that follows describes the intended route, not a measured win.

Before collecting results, fix the task set, dataset split, success measures and comparison conditions. A useful sequence is:

1. **Base model:** a strong prompt with the same permitted task inputs.
2. **Base model with matching context/tools:** isolates the benefit of the assembled workflow from withholding useful information from the baseline.
3. **YAP with retrieval and editable personal memory:** measures the contribution of relevant history.
4. **YAP with evaluated tuning or shared learning:** measures any additional contribution from trained models or aggregate data.

Hold out both sessions and users where appropriate. Separate objective measures (completion, errors, latency, cost, prediction calibration) from human judgments (clarity, voice fidelity, useful coaching). Blind human reviewers to system identity where possible. For actual learning, measure later unassisted performance as well as performance while using YAP.

Release the prompts, model versions, settings, scoring definitions, anonymised or synthetic reproducible examples, individual results and uncertainty estimates that can be shared lawfully and with permission. Private recordings are not a prerequisite for public reproduction: a shareable evaluation set can exercise the same protocol. Report a limited benchmark honestly rather than extrapolating it to all communication or all frontier models.

## What a reviewer can verify immediately

- Read [README.md](../README.md) and run the prototype locally.
- Run `npm run test:review`: 237 selected checks passed when this review snapshot was prepared.
- Run `npm run replay -- --fast`: a labelled synthetic sample, not a live model-performance benchmark.
- Inspect [ROADMAP.md](../ROADMAP.md) for modules, dependencies and delivery gates.
- Inspect [NOTICE](../NOTICE) for reused components and the [README](../README.md#your-data-and-model-use) for model/data boundaries.

The intended distinction is simple: this first pass is inspectable evidence of the starting point; the roadmap and these checks define the route toward the full claims.
