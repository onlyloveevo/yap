# Prepare angles for a new brief

You are Claude Code, inside the YAP app folder. Follow these steps to prepare a new brief: an idea, three talking points, and 2-3 prepared angles for each point. YAP uses the angles during a take: when the person says "Hey YAP, I don't like the tips angle", it swaps to another prepared angle on the spot, with no network call. Angles have to exist before the take starts.

## 1. Ask for the idea and the three points

Ask the person, in plain words:

1. What is the video's idea, in one line?
2. What are your three talking points, in order? A short title for each is enough (for example "Hook", "What I do", "Takeaway").

Use their words. Do not invent the idea or the points for them. If they give fewer than three points, ask for the rest.

## 2. Write 2-3 angles for each point

An angle is another way into the same point. For each point, write 2-3 angles:

- Give each angle a one-word label. Use labels such as `tips`, `story` and `numbers`, and keep the same label across points where it fits, so one remark ("let's do the story instead") can move every point ahead at once.
  - The label must not be a word YAP itself listens for, such as more, one, how, back, need, show, get, change or feeling. A plain noun is safest. A brief with such a label is refused when it is loaded.
- `text`: the talking point itself, one line, as it will show on the teleprompter. Keep it in the person's voice and about their idea.
- `reply`: YAP's silent on-screen answer when the person swaps to this angle. One line, a question or a nudge that helps them keep talking ("What was the moment you realised?"). Never a grade, score or judgement of the person or their delivery.
- `keywords`: 3-5 lower-case words someone might say when asking for this angle. Words from the angle's own text work well.

The first angle of each point is the one shown at the start; put its id in the point's `active` field.

## 3. Write the brief file

Write the result to a new JSON file, for example `briefs/<short-name>.json` inside the app folder. Never overwrite `sample/brief.json`. The file has exactly this shape:

- `version`: the number `1`
- `label`: the string `"sample"`
- `idea`: the idea, one line
- `points`: an array of exactly 3 points. Each point has:
  - `id`: `"p1"`, `"p2"`, `"p3"`
  - `title`: the point's short title
  - `active`: the id of the angle shown first
  - `angles`: an array of 2-3 angles. Each angle has:
    - `id`: the point id, a dash and the label, for example `"p2-story"`
    - `label`: the one-word label
    - `text`: the one-line talking point
    - `reply`: the one-line silent on-screen reply
    - `keywords`: an array of 3-5 strings

Write the whole file in one go, so a half-written file is never left behind.

## 4. Validate it with parseBrief

Run this from the app folder, with your file's path in place of `briefs/<short-name>.json`:

```sh
node -e "import('./src/engine/brief.js').then(({ parseBrief }) => { const f = process.argv[1]; parseBrief(require('fs').readFileSync(f, 'utf8'), f); console.log('brief ok: ' + f); }).catch((e) => { console.error(e.message); process.exit(1); })" briefs/<short-name>.json
```

If it prints an error, it names the file and the first problem (for example "point p2 needs 2-3 angles (found 4)"). Fix that problem in the file and run the command again, until it prints `brief ok`.

## 5. Tell the person

Say which file you wrote and list each point with its angle labels, for example "Hook: tips, story". Then they can record with it.
