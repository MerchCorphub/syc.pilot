// Scan Your Color pilot settings.
// The publishable key is safe to ship in the browser: database rules decide what it can do.
export const SUPABASE_URL = 'https://fkuppeocewsffiraojyz.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_du0Kb3KGUVGmr7LUo4XEwA_9hkvLu1T';
export const PHOTO_BUCKET = 'scan-photos';
export const READER_VERSION = 'chart-refs-1';

// Four color stages, from the SYC working model.
export const STAGES = [
  { num: 1, key: 'green', name: 'Green', fill: '#95B020', desc: 'Mostly green' },
  { num: 2, key: 'firm', name: 'Firm Ready', fill: '#C4C821', desc: 'Half yellow, half green' },
  { num: 3, key: 'ripe', name: 'Ripe Ready', fill: '#E8C523', desc: 'Mostly yellow' },
  { num: 4, key: 'spotty', name: 'Spotty', fill: '#E9B925', desc: 'Yellow with dark spots' },
];

// Scan behaviour
export const SCAN = {
  maxMs: 8000,        // how long one scan may run
  readEveryMs: 100,   // time between color readings
  lockConfidence: 0.85,
  lockFrames: 3,
  minReadings: 5,     // readings needed to accept a scan that never locked
  photos: 3,          // pictures stored per scan
  photoMaxSide: 720,
};
