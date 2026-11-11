// Scan Your Color pilot settings.
// The publishable key is safe to ship in the browser: database rules decide what it can do.
export const SUPABASE_URL = 'https://fkuppeocewsffiraojyz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_du0Kb3KGUVGmr7LUo4XEwA_9hkvLu1T';
export const PHOTO_BUCKET = 'scan-photos';
export const READER_VERSION = { chart: 'chart-refs-1', learned: 'knn-1' };

// Four color stages, from the SYC working model.
export const STAGES = [
  { num: 1, key: 'green', name: 'Green', fill: '#95B020', desc: 'Mostly green', uses: ['Ripen at home', 'Cook now', 'Plantain-style'] },
  { num: 2, key: 'firm', name: 'Firm Ready', fill: '#C4C821', desc: 'Half yellow, half green', uses: ['Lunchbox', 'Snacking', 'Slicing'] },
  { num: 3, key: 'ripe', name: 'Ripe Ready', fill: '#E8C523', desc: 'Mostly yellow', uses: ['Cereal', 'Smoothies', 'For the kids'] },
  { num: 4, key: 'spotty', name: 'Spotty', fill: '#E9B925', desc: 'Yellow with dark spots', uses: ['Banana bread', 'Freeze', 'Pancakes'] },
];

// Scan behaviour
export const SCAN = {
  maxMs: 6000,        // longest one live scan may run before it decides
  giveUpMs: 3500,     // stop early when nothing readable has been seen by now, and show what to fix
  readEveryMs: 100,   // time between color readings
  lockConfidence: 0.85,
  lockFrames: 3,
  quickReadings: 8,   // after this many readings, accept as soon as one stage has a clear lead
  quickShare: 0.6,    // share of readings the leading stage needs for that quick decision
  minReadings: 3,     // at time-out, readings needed to accept the leading stage (a 50/50 scan leans to the leader)
  knnMin: 8,          // reference samples needed in EVERY stage before the learned matcher takes over
  knnK: 7,
  photos: 3,          // pictures stored per scan
  photoMaxSide: 720,
};
