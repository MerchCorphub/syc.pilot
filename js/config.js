// Scan Your Color pilot settings.
// The publishable key is safe to ship in the browser: database rules decide what it can do.
export const SUPABASE_URL = 'https://fkuppeocewsffiraojyz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_du0Kb3KGUVGmr7LUo4XEwA_9hkvLu1T';
export const PHOTO_BUCKET = 'scan-photos';
export const READER_VERSION = { chart: 'vote-1', learned: 'vote-knn-1' };

// Four color stages, from the SYC working model.
export const STAGES = [
  { num: 1, key: 'green', name: 'Green', fill: '#95B020', desc: 'Mostly green', uses: ['Ripen at home', 'Cook now', 'Plantain-style'] },
  { num: 2, key: 'firm', name: 'Firm Ready', fill: '#C4C821', desc: 'Half yellow, half green', uses: ['Lunchbox', 'Snacking', 'Slicing'] },
  { num: 3, key: 'ripe', name: 'Ripe Ready', fill: '#E8C523', desc: 'Mostly yellow', uses: ['Cereal', 'Smoothies', 'For the kids'] },
  { num: 4, key: 'spotty', name: 'Spotty', fill: '#E9B925', desc: 'Yellow with dark spots', uses: ['Banana bread', 'Freeze', 'Pancakes'] },
];

// A session starts when the app opens and lasts this long. The shopper may finish the scan or survey
// they are on; after that they return to the welcome screen. One survey per session.
export const SESSION_MS = 5 * 60 * 1000;

// Distance guide. The inches are an estimate from how large the bananas look in the camera,
// based on a typical bunch size and a typical phone lens.
export const DISTANCE = { minIn: 12, maxIn: 24, bananaIn: 8, fovDeg: 60, everyMs: 300 };

// "Ready When You Are": matching the scanned stage to when the shopper wants to eat.
// This is a rules layer on top of the color reader. Change it here without touching the reader.
// These are shopping suggestions, never promised ripening times.
export const EATING = {
  options: [
    { key: 'today', label: 'Today', line: "I'm ready to enjoy them now.", plan: 'Eat today' },
    { key: 'tomorrow', label: 'Tomorrow', line: 'I want them ready soon.', plan: 'Eat tomorrow' },
    { key: '2_3_days', label: 'In 2–3 Days', line: "I'm planning ahead.", plan: 'Eat in 2–3 days' },
    { key: 'later_this_week', label: 'Later This Week', line: 'I want them to last longer.', plan: 'Eat later this week' },
  ],
  // which stages (1 to 4) are a good match for each timeframe
  good: { today: [3, 4], tomorrow: [2, 3], '2_3_days': [1, 2], later_this_week: [1] },
  categories: { good_match: 'Good Match', ready_earlier: 'May Be Ready Earlier', needs_more_time: 'May Need More Time' },
  explain: {
    good_match: {
      today: 'These bananas look right for eating today.',
      tomorrow: 'These bananas look right for eating about tomorrow.',
      '2_3_days': 'These bananas may become more yellow over the next few days.',
      later_this_week: 'Greener bananas like these usually keep the longest.',
    },
    ready_earlier: 'These bananas are further along than your plan. They may be ready before you want them. A greener bunch may suit you better.',
    needs_more_time: 'These bananas are greener than your plan. They may need more time before they are how you like them. A more yellow bunch may suit you better.',
    softer: 'Spotty bananas are soft and sweet. They suit shoppers who like a softer banana today.',
    always: 'Actual ripening depends on storage conditions.',
  },
};

// Reader defaults. The admin page can change these per stage (Reference pictures tab).
export const READER = {
  chartWeight: 2,      // the built-in chart color counts like this many staff pictures when blending
  lowLightL: 63,       // peel lightness below this is treated as low light (warn, and discount dark spots)
  shareWeight: 0.8,    // weight of the green/yellow share vote next to the hue vote (1.0)
  spotWeight: 0.9,     // weight of the dark-spot vote when it fires
};

// Scan behaviour
export const SCAN = {
  maxMs: 6000,        // longest one live scan may run before it decides
  giveUpMs: 3500,     // stop early when nothing readable has been seen by now, and show what to fix
  readEveryMs: 100,   // time between color readings
  lockConfidence: 0.85,
  lockFrames: 5,
  quickReadings: 8,   // after this many readings, accept as soon as one stage has a clear lead
  quickShare: 0.6,    // share of readings the leading stage needs for that quick decision
  minReadings: 3,     // at time-out, readings needed to accept the leading stage (a 50/50 scan leans to the leader)
  knnMin: 8,          // reference samples needed in EVERY stage before the learned matcher takes over
  knnK: 7,
  photos: 3,          // pictures stored per scan
  photoMaxSide: 720,
};
