// The Review detail for the sample video (SCREEN-07): the review screen of Deth's Loom frame. Its
// numbers, its chart and its key moments are sample data, said once by the tag beside the title.
// The sample video is 8:27 long and has no footage: the player shows its own stills, the frame at 0:14
// and one at each key moment, so the picture, the title, the thumbnails and the length are one video.
// A lesson picked here stays in this browser, apart from the person's own.
import { mountReview, fmt } from './page.js';
import { lessonStore } from '../lib/return-model.js';
import { answerQuestion } from '../lib/review-own.js';

const DURATION = 507; // 8:27 in seconds
const TITLE = 'Why this matters';

// YAP's reply for each number. Each states only numbers that are on the screen.
const NUMBERS = [
  { label: 'Views', value: '234K', delta: 12, icon: 'eye', spark: [3, 4, 3.6, 5, 4.6, 6, 6.5], keys: ['view', 'watched'],
    reply: 'Views are 234K, up 12%. Impressions rose 18% over the same days, so most of the gain came from the video being shown to more people.' },
  { label: 'Impressions', value: '1.8M', delta: 18, icon: 'scan', spark: [3, 3.5, 3.2, 4.8, 4.4, 5.8, 6.4], keys: ['impression', 'shown', 'reach'],
    reply: 'Impressions are 1.8M, up 18%. This video was shown to more people. Click-through rate says whether they chose to watch.' },
  { label: 'CTR', value: '6.4%', delta: -22, icon: 'cursor', spark: [5, 6.5, 6, 6.8, 5.2, 4.2, 4.6], keys: ['ctr', 'click', 'click-through', 'thumbnail', 'title'],
    reply: 'Click-through rate is 6.4%, down 22%. More people saw the video and fewer chose it. The title and thumbnail may not state a specific promise. The simple experiment below compares one.' },
  { label: 'Avg view duration', value: '4:32', delta: 14, icon: 'clock', spark: [3, 3.4, 3.2, 4.4, 4.2, 5.4, 5.8], keys: ['view duration', 'average view', 'avg', 'how long'],
    reply: 'Avg view duration is 4:32, up 14%. People who watch are staying longer. The retention chart shows where they leave.' },
  { label: 'Watch time', value: '17.6K', unit: ' hrs', delta: 9, icon: 'chart', spark: [3.5, 3.8, 3.6, 4.6, 4.4, 5.2, 5.6], keys: ['watch time', 'hours'],
    reply: 'Watch time is 17.6K hrs, up 9%. It grows more slowly than views, which are up 12%.' },
];

// seconds, audience % still watching at that point (the curve passes through these). Each key moment's label
// and reading name the number the curve has there; 2:20 keeps the Loom frame's own words.
const YOU = [[0, 100], [4, 93], [10, 80], [20, 68], [35, 61], [55, 56], [72, 52], [90, 50], [110, 45], [125, 44], [140, 38], [160, 37], [190, 36], [215, 38], [245, 41], [262, 36], [285, 31], [310, 29], [330, 27], [355, 27], [380, 24], [405, 23], [430, 20], [450, 19], [470, 16], [490, 15], [507, 14]];
const AVG = [[0, 100], [4, 85], [10, 68], [20, 58], [40, 52], [72, 44], [110, 36], [140, 32], [190, 29], [245, 28], [285, 25], [330, 22], [380, 19], [430, 16], [470, 13], [507, 11]];

const MOMENTS = [
  { at: 0, label: 'Strong start', tip: '100% watching', keys: ['start', 'opening', 'intro', 'hook'], text: 'viewers are fully with you. The opening line is clear and the picture is steady, so almost everyone stays for the first few seconds.' },
  { at: 72, label: 'High retention', tip: '52% still watching', keys: ['retention', 'stay', 'audience'], text: 'about half of viewers are still watching, which is above your channel average here. The pace is brisk and each sentence adds something new.' },
  { at: 140, label: 'Notable drop', tip: '38% audience left here', keys: ['drop', 'dip', 'leave', 'left', 'lose', 'lost'], text: "38% of viewers left. This dip often happens when the topic shifts from the big idea to a more detailed explanation. The energy drops and the hook from the intro isn't reinforced." },
  { at: 245, label: 'Spike', tip: '41% watching, up from 36%', keys: ['spike', 'rewatch', 'peak'], text: '41% of viewers are watching, up from 36% at 3:10. Some went back to re-watch. A concrete example with a visual seems to have pulled attention back in.' },
  { at: 330, label: 'Steady', tip: '27% still watching', keys: ['steady', 'middle'], text: 'viewership holds steady. Nothing here pushes people away, but nothing new pulls them in either. A small pattern change could help.' },
  { at: 430, label: 'Strong finish', tip: '20% still watching', keys: ['finish', 'ending', 'end', 'last'], text: 'most remaining viewers watch to the end. The recap and the clear next step keep them until the last line.' },
].map((m, i) => ({ time: m.at, clock: fmt(m.at), label: m.label, tip: m.tip, reading: `At ${fmt(m.at)}, ${m.text}`, img: `assets/moment-${i + 1}.jpg`, keys: m.keys }));

const EXPERIMENT = { text: 'Test a clearer thumbnail with a stronger, more specific hook.', more: 'Thumbnails with text get higher CTR, especially when the value is obvious.' };

// The same sample data as sentences, for a typed question: asked of the model on this machine, or read straight from here.
const review = {
  summary: 'Click-through rate is the number that fell: 6.4%, down 22%, while views and impressions rose. Inside the video the biggest loss is at 2:20, where 38% of viewers left.',
  experiment: EXPERIMENT,
  moments: MOMENTS.map((m) => ({ time: m.time, text: m.reading })),
  facts: [
    ...NUMBERS.map((n) => ({ id: n.label, keys: n.keys, text: n.reply })),
    ...MOMENTS.map((m) => ({ id: m.clock, keys: m.keys, text: m.reading })),
    { id: 'next', keys: ['next', 'try', 'improve', 'better', 'change', 'fix', 'should', 'experiment', 'grow'], text: `${EXPERIMENT.text} ${EXPERIMENT.more}` },
  ],
};
const evidence = {
  transcript: `Sample video "${TITLE}", ${fmt(DURATION)} long, published Jan 12, 2025. Numbers for the last 28 days. ${NUMBERS.map((n) => n.reply).join(' ')} The experiment YAP proposes: ${EXPERIMENT.text} ${EXPERIMENT.more}`,
  notes: MOMENTS.map((m) => ({ time: m.time, text: `${m.label}. ${m.reading}` })),
};

mountReview({
  id: 'sample-video',
  sample: true,
  title: TITLE,
  published: 'Published Jan 12, 2025',
  range: 'Last 28 days',
  duration: DURATION,
  media: { start: 14, stills: [{ at: 14, img: 'assets/video.jpg' }, ...MOMENTS.map((m) => ({ at: m.time, img: m.img, small: true }))].sort((a, b) => a.at - b.at) },
  numbers: NUMBERS,
  selectedNumber: 2,
  chart: {
    heading: 'Audience retention',
    label: 'Audience retention, sample data',
    legend: [{ tone: 'purple', label: 'This video' }, { tone: 'grey', label: 'Your channel average' }],
    yTicks: [100, 66, 33, 0].map((p) => ({ at: p / 100, label: `${p}%` })),
    you: YOU.map(([t, p]) => [t, p / 100]),
    other: AVG.map(([t, p]) => [t, p / 100]),
  },
  moments: MOMENTS,
  selectedMoment: 2,
  experiment: { ...EXPERIMENT, current: { img: 'assets/thumb-current.jpg' }, proposed: { img: 'assets/thumb-proposed.jpg' } },
  source: { id: 'sample-video', title: TITLE },
  store: lessonStore({ sample: true, storage: localStorage }),
  answer: (question) => answerQuestion({ question, evidence, review }),
  placeholder: 'Why is CTR lower than my other videos?',
});
