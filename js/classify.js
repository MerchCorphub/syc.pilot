// Scan Your Color pilot: stage decision by three methods that vote.
//   1. Hue match     the peel's average hue against each stage's color (chart blended with staff pictures,
//                    or the learned picture library once every stage has enough pictures)
//   2. Color share   how much of the peel sits on the green side vs the yellow side
//   3. Dark spots    spotting on yellow fruit, discounted in low light where shadows look like spots
import { REFS, KEYS, matchStage, knnMatch, knnReady } from './reader.js';
import { STAGES, SCAN, READER } from './config.js';

const num = (k) => STAGES.find((s) => s.key === k).num;
const mean = (a) => a.reduce((t, x) => t + x, 0) / a.length;

// The color each stage is matched against, and where it came from.
export function effectiveRefs(samples, settings) {
  const cfg = (settings && settings.stages) || {};
  const W = READER.chartWeight;
  const staff = {};
  KEYS.forEach((k) => { staff[k] = (samples || []).filter((x) => x.src === 'staff' && x.stage === k); });
  const refs = {}, bands = {}, info = {};
  KEYS.forEach((k) => {
    const c = cfg[num(k)] || {}, st = staff[k], chart = REFS[k];
    const hues = st.map((x) => x.hue);
    const staffMean = st.length ? mean(hues) : null;
    let hue, source;
    if (typeof c.hue === 'number') { hue = c.hue; source = 'your number'; }
    else if (st.length && c.use_chart === false) { hue = staffMean; source = 'staff pictures only'; }
    else if (st.length) { hue = (chart.hue * W + staffMean * st.length) / (W + st.length); source = 'chart + staff pictures'; }
    else { hue = chart.hue; source = 'chart'; }
    const spot = st.length ? (chart.spot * W + st.reduce((t, x) => t + (x.spot || 0), 0)) / (W + st.length) : chart.spot;
    refs[k] = Object.assign({}, chart, { hue, spot });
    if (typeof c.variation === 'number') bands[k] = c.variation;
    info[k] = { chart: chart.hue, staffN: st.length, staffMean, staffMin: st.length ? Math.min(...hues) : null, staffMax: st.length ? Math.max(...hues) : null,
      manual: typeof c.hue === 'number' ? c.hue : null, useChart: c.use_chart !== false, variation: typeof c.variation === 'number' ? c.variation : null, used: hue, source };
  });
  const order = KEYS.map((k) => refs[k].hue);
  const ordered = order.every((h, i) => i === 0 || h < order[i - 1]);
  // neighbouring stages whose colors are too close to tell apart
  const close = [];
  for (let i = 1; i < KEYS.length; i++) if (Math.abs(order[i - 1] - order[i]) < 2.5) close.push([KEYS[i - 1], KEYS[i]]);
  return { refs, bands, info, ordered, close };
}

const lowL = (settings) => (settings && typeof settings.low_light_L === 'number' ? settings.low_light_L : READER.lowLightL);
export const isDim = (reading, settings) => !!reading && ((reading.light && reading.light.klass === 'too dark') || (typeof reading.L === 'number' && reading.L < lowL(settings)));

// reading: from readSource. profile: from peelProfile (may be null). ctx: { samples, settings, eff }
export function classify(reading, profile, ctx) {
  const settings = ctx.settings || {}, eff = ctx.eff || effectiveRefs(ctx.samples, settings);
  const dim = isDim(reading, settings);
  // 3a. in low light shadows read as dark spots: discount them
  const cut = lowL(settings);
  const spotAdj = dim ? reading.spot * Math.max(0.25, Math.min(1, (reading.L - 45) / Math.max(1, cut + 6 - 45))) * 0.7 : reading.spot;
  const r = Object.assign({}, reading, { spot: spotAdj });

  // 1. hue
  const learned = knnReady(ctx.samples || [], SCAN.knnMin);
  const A = learned ? knnMatch(r, ctx.samples, SCAN.knnK) : matchStage(r, eff.refs, r.light, eff.bands);

  // 2. share of the peel in each color zone (zones sit halfway between neighbouring stage colors)
  const R = eff.refs;
  const tG = (R.green.hue + R.firm.hue) / 2, tY = (R.firm.hue + R.ripe.hue) / 2, tS = (R.ripe.hue + R.spotty.hue) / 2;
  let B = null, shares = null;
  if (profile && profile.ok && tG > tY && tY > tS) {
    const z = { green: 0, firm: 0, ripe: 0, spotty: 0 };
    profile.bins.forEach((c, h) => { z[h >= tG ? 'green' : h >= tY ? 'firm' : h >= tS ? 'ripe' : 'spotty'] += c; });
    shares = {}; KEYS.forEach((k) => { shares[k] = Math.round((z[k] / profile.n) * 100) / 100; });
    // "half yellow, half green": neither side dominates
    const greenSide = shares.green, yellowSide = shares.ripe + shares.spotty;
    if (greenSide >= 0.55) B = 'green';
    else if (yellowSide >= 0.55) B = shares.spotty > shares.ripe ? 'spotty' : 'ripe';
    else B = 'firm';
  }

  // 3. dark spots, only meaningful on fruit that is already on the yellow side
  const spotCut = Math.max(4, (R.ripe.spot + R.spotty.spot) / 2 + 1);
  const C = (spotAdj >= spotCut && reading.hue < tY) ? 'spotty' : null;

  // vote
  const tally = {};
  const add = (k, w) => { if (k) tally[k] = (tally[k] || 0) + w; };
  add(A.key, 1); add(B, READER.shareWeight); add(C, READER.spotWeight);
  const ranked = Object.keys(tally).sort((a, b) => (tally[b] - tally[a]) || (a === A.key ? -1 : b === A.key ? 1 : 0));
  const key = ranked[0];
  const agree = [A.key, B, C].filter((k) => k === key).length, voters = [A.key, B, C].filter(Boolean).length;
  let conf = A.conf;
  if (key !== A.key) conf = Math.min(conf, 0.5);
  else if (B && B === key) conf = Math.min(1, conf + 0.25);
  else if (B && B !== key) conf *= 0.7;
  if (dim) conf *= 0.85;
  const second = ranked[1] || (A.second !== key ? A.second : null);
  return {
    key, second, conf, between: !!A.between || agree < voters, knn: !!A.knn, votes: A.votes, k: A.k,
    methods: { hue: A.key, share: B, spots: C }, agree, voters, shares, dim, spotAdj: Math.round(spotAdj * 10) / 10,
  };
}
