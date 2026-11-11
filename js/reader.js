// Scan Your Color color reader. Taken from the SYC working model (MerchCorphub/SYC).
// Patent pending, U.S. App. No. 19/836,387. (c) Merch Corporation.


// measured from the four calibration photos in assets/
// Fallback only — used for the split second before the shipped chart photos
// decode. These are what those four photos measure.
const REFS={green:{hue:105.0,chroma:71.0,L:74.0,spot:1},firm:{hue:100.0,chroma:73.0,L:80.0,spot:1},
  ripe:{hue:99.0,chroma:73.0,L:76.0,spot:1},spotty:{hue:90.0,chroma:66.0,L:72.0,spot:7}};

function rgb2lab(r,g,b){
  let R=r/255,G=g/255,B=b/255;
  R=R>0.04045?Math.pow((R+0.055)/1.055,2.4):R/12.92;
  G=G>0.04045?Math.pow((G+0.055)/1.055,2.4):G/12.92;
  B=B>0.04045?Math.pow((B+0.055)/1.055,2.4):B/12.92;
  let X=(R*0.4124+G*0.3576+B*0.1805)/0.95047, Y=R*0.2126+G*0.7152+B*0.0722, Z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
  const fn=t=>t>0.008856?Math.cbrt(t):(7.787*t+16/116);
  X=fn(X);Y=fn(Y);Z=fn(Z);
  return [116*Y-16,500*(X-Y),200*(Y-Z)];
}

// ---- peel measurement -----------------------------------------------------
// One estimator, two regions. A live frame trusts the reticle (the shopper aims
// it); a still photo has no reticle, so the peel is found by colour and the
// largest cluster of it is measured. Both then run the SAME gate and the same
// trimmed-mean estimator, which is what keeps a calibration photo and a live
// scan of the same fruit landing on the same hue.
function peelGate(L,A,B){
  if(L<34||L>97) return 0;
  const c=Math.sqrt(A*A+B*B);
  if(c<26||B<16) return 0;
  const hu=(Math.atan2(B,A)*180/Math.PI+360)%360;
  return (hu>=58&&hu<=142)?1:0;
}
function brownGate(L,A,B){
  if(L>=56||L<12) return 0;                     // dark, but not pure shadow
  const c=Math.sqrt(A*A+B*B);
  if(c>50) return 0;
  const hu=(Math.atan2(B,A)*180/Math.PI+360)%360;
  return (hu>=18&&hu<=115)?1:0;
}
function trimmedMean(arr,lo,hi){
  if(!arr.length) return 0;
  const a=arr.slice().sort((p,q)=>p-q);
  const i0=Math.floor(a.length*lo), i1=Math.max(i0+1,Math.ceil(a.length*hi));
  let t=0,n=0; for(let i=i0;i<i1;i++){t+=a[i];n++;}
  return n?t/n:a[Math.floor(a.length/2)];
}

// mode 'live' = centre reticle, 'still' = dominant peel cluster
function measurePeel(data,w,hgt,gains,bias,mode){
  const ba0=(bias&&bias[0])||0, bb0=(bias&&bias[1])||0;
  const N=w*hgt;
  const peel=new Uint8Array(N), brown=new Uint8Array(N);
  const Ls=new Float32Array(N), As=new Float32Array(N), Bs=new Float32Array(N);
  let px=0,py=0,pn=0;
  for(let y=0;y<hgt;y++) for(let x=0;x<w;x++){
    const i=(y*w+x)*4, j=y*w+x;
    const R=Math.min(255,data[i]*gains[0]), G=Math.min(255,data[i+1]*gains[1]), B=Math.min(255,data[i+2]*gains[2]);
    const lab=rgb2lab(R,G,B);
    const L=lab[0], A=lab[1]-ba0, B2=lab[2]-bb0;
    Ls[j]=L;As[j]=A;Bs[j]=B2;
    if(peelGate(L,A,B2)){peel[j]=1;px+=x;py+=y;pn++;}
    else if(brownGate(L,A,B2)) brown[j]=1;
  }

  // region of interest
  let cx,cy,rad;
  if(mode==='all'){
    if(pn<120) return {ok:false,peelShare:pn/N};
    cx=w/2; cy=hgt/2; rad=Math.hypot(w,hgt);            // whole crop
  }else if(mode==='still'){
    if(pn<180) return {ok:false,peelShare:pn/N};
    // centroid of the peel nearest the middle — people centre the fruit, and
    // background yellow tends to sit at the edges
    let qx=0,qy=0,qn=0;
    for(let y=Math.round(hgt*0.12);y<hgt*0.88;y++) for(let x=Math.round(w*0.12);x<w*0.88;x++){
      if(peel[y*w+x]){qx+=x;qy+=y;qn++;}
    }
    cx=qn?qx/qn:px/pn; cy=qn?qy/qn:py/pn;
    const ds=[];
    for(let y=0;y<hgt;y+=2) for(let x=0;x<w;x+=2){ if(peel[y*w+x]) ds.push(Math.hypot(x-cx,y-cy)); }
    ds.sort((a,b)=>a-b);
    rad=Math.max(12,ds[Math.floor(ds.length*0.55)]||Math.min(w,hgt)*0.3);
  }else{
    cx=w/2; cy=hgt/2; rad=Math.min(w,hgt)*0.34;
  }
  const r2=rad*rad;

  // does a dark pixel sit ON the fruit? sample a ring of neighbours
  const OFF=[[4,0],[-4,0],[0,4],[0,-4],[3,3],[-3,3],[3,-3],[-3,-3]];
  const onPeel=(x,y)=>{
    let c=0;
    for(let k=0;k<OFF.length;k++){
      const nx=x+OFF[k][0], ny=y+OFF[k][1];
      if(nx<0||ny<0||nx>=w||ny>=hgt) continue;
      if(peel[ny*w+nx]) c++;
      if(c>=3) return true;
    }
    return false;
  };

  const hues=[],chs=[],lls=[];
  let inside=0, spots=0, peelN=0;
  for(let y=0;y<hgt;y++) for(let x=0;x<w;x++){
    const dx=x-cx, dy=y-cy;
    if(dx*dx+dy*dy>r2) continue;
    inside++;
    const j=y*w+x;
    if(peel[j]){
      peelN++;
      hues.push((Math.atan2(Bs[j],As[j])*180/Math.PI+360)%360);
      chs.push(Math.hypot(As[j],Bs[j]));
      lls.push(Ls[j]);
    }else if(brown[j]&&onPeel(x,y)) spots++;
  }
  if(peelN<120) return {ok:false,peelShare:inside?peelN/inside:0};

  const hue=trimmedMean(hues,0.15,0.85);
  const chroma=trimmedMean(chs,0.15,0.85);
  const L=trimmedMean(lls,0.15,0.85);
  const rad2=hue*Math.PI/180;
  return {ok:true,L:L,hue:hue,chroma:chroma,
    spot:100*spots/Math.max(1,peelN+spots),
    peelShare:inside?peelN/inside:0,
    hex:labHex(L,Math.cos(rad2)*chroma,Math.sin(rad2)*chroma)};
}

function analyseFrame(data,w,hgt,gains,bias){return measurePeel(data,w,hgt,gains,bias,'live');}

// ---- lighting detection ---------------------------------------------------
// Runs BEFORE any hue is computed. Two estimators over the frame border only
// (shelf and packaging, never the fruit): a grey-world average of near-neutral
// pixels, and a white-patch estimate from the brightest neutrals. Blending the
// two survives both a warm tungsten wash and a single bright spotlight.
//
// After the gains are applied, a truly neutral surface should read a*=b*=0.
// Whatever a*/b* it still carries is the illuminant's residual tint, so we
// return it as a bias and subtract it from the fruit — that residual is
// exactly the error that used to push a yellow peel a few degrees off.
function estimateLighting(data,w,hgt,whole){
  const cx=w/2, cy=hgt/2, rOut=Math.min(w,hgt)*0.46;
  let r=0,g=0,b=0,n=0, hi=[], lumSum=0, lumN=0;
  for(let y=0;y<hgt;y+=3) for(let x=0;x<w;x+=3){
    const i=(y*w+x)*4, R=data[i],G=data[i+1],B=data[i+2];
    const mx=Math.max(R,G,B),mn=Math.min(R,G,B);
    lumSum+=0.2126*R+0.7152*G+0.0722*B; lumN++;
    const dx=x-cx, dy=y-cy;
    if(!whole && dx*dx+dy*dy<rOut*rOut) continue; // border ring only (live frames)
    if(mx<40||mx>252) continue;
    if((mx-mn)/mx>0.34) continue;                 // only near-neutral surfaces
    r+=R;g+=G;b+=B;n++;
    hi.push([R,G,B,mx]);
  }
  const lum=lumN?lumSum/lumN:0;
  const dim=lum<58, glare=lum>212;
  if(n<40) return {gains:[1,1,1],bias:[0,0],ok:false,conf:0,klass:dim?'too dark':'unknown',cct:0,lum:lum};

  const mr=r/n,mg=g/n,mb=b/n;
  // white patch: mean of the top ~12% brightest neutrals
  hi.sort((p,q)=>q[3]-p[3]);
  const top=hi.slice(0,Math.max(6,Math.round(hi.length*0.12)));
  let wr=0,wg=0,wb=0; top.forEach(p=>{wr+=p[0];wg+=p[1];wb+=p[2];});
  wr/=top.length; wg/=top.length; wb/=top.length;

  // blend grey-world with white-patch; white-patch leads when it is well lit
  const k=Math.min(0.6,Math.max(0.2,(wg-mg)/160+0.3));
  const er=mr*(1-k)+wr*k, eg=mg*(1-k)+wg*k, eb=mb*(1-k)+wb*k;
  const avg=(er+eg+eb)/3;
  const cl=v=>Math.max(0.72,Math.min(1.38,v));
  const gains=[cl(avg/er),cl(avg/eg),cl(avg/eb)];

  // residual tint of the corrected neutral = the illuminant's own cast
  const nl=rgb2lab(Math.min(255,er*gains[0]),Math.min(255,eg*gains[1]),Math.min(255,eb*gains[2]));
  const bias=[nl[1],nl[2]];

  // crude correlated colour temperature from the blue/red balance of the neutral
  const ratio=eb/Math.max(1,er);
  const cct=Math.round(Math.max(2200,Math.min(8000,1900+3900*ratio)));
  const klass=dim?'too dark':glare?'glare':cct<3300?'warm indoor':cct>5600?'cool daylight':'neutral store light';

  // how much we trust it: enough neutral surface, not dim, not blown out
  const conf=Math.max(0,Math.min(1,(Math.min(1,n/160))*(dim?0.45:1)*(glare?0.6:1)));
  return {gains:gains,bias:bias,ok:true,conf:conf,klass:klass,cct:cct,lum:lum,
    cast:Math.round(Math.sqrt(bias[0]*bias[0]+bias[1]*bias[1])*10)/10};
}

// kept for callers that only want the gains
function borderGains(data,w,hgt){return estimateLighting(data,w,hgt).gains;}

function labHex(L,A,B){
  const fy=(L+16)/116, fx=fy+A/500, fz=fy-B/200;
  const inv=t=>{const t3=t*t*t;return t3>0.008856?t3:(t-16/116)/7.787;};
  let X=inv(fx)*0.95047, Y=inv(fy), Z=inv(fz)*1.08883;
  let r=X*3.2406+Y*-1.5372+Z*-0.4986, g=X*-0.9689+Y*1.8758+Z*0.0415, b=X*0.0557+Y*-0.2040+Z*1.0570;
  const gam=c=>{c=c<=0.0031308?12.92*c:1.055*Math.pow(Math.max(0,c),1/2.4)-0.055;
    return ('0'+Math.max(0,Math.min(255,Math.round(c*255))).toString(16)).slice(-2);};
  return '#'+gam(r)+gam(g)+gam(b);
}

// How far apart the chart's stages actually sit. A tightly-calibrated chart has
// small gaps, so tolerance and margin must scale to it — a fixed 11°/7° made a
// close chart unmatchable and a wide one over-confident.
function ladderGap(refs){
  const hs=Object.keys(refs).map(k=>refs[k].hue).sort((a,b)=>b-a);
  const gaps=[];
  for(let i=1;i<hs.length;i++) gaps.push(Math.abs(hs[i-1]-hs[i]));
  if(!gaps.length) return 9;
  gaps.sort((a,b)=>a-b);
  return Math.max(3.5,gaps[Math.floor(gaps.length/2)]);
}

// A stage is a BAND, not a point: anything inside ±band of the reference hue is
// that stage outright, so a good read locks on the first frame instead of
// creeping up while the hue jitters a degree either way.
//
// Bands may never overlap. A band wider than half the distance to its nearest
// neighbour would make two stages indistinguishable, so the operator's setting
// is CLAMPED to the chart it is running against and the UI shows the clamp.
const BAND_DEFAULT=10;
function bandFor(bands,k,fallback){
  const v=bands&&bands[k];
  return Math.max(2,Math.min(30,typeof v==='number'?v:(fallback||BAND_DEFAULT)));
}
// widest band this stage can take before it would touch a neighbour
function bandCeiling(refs,k){
  const h=refs[k]&&refs[k].hue;
  if(typeof h!=='number') return 30;
  let near=Infinity;
  Object.keys(refs).forEach(o=>{
    if(o===k||typeof (refs[o]||{}).hue!=='number') return;
    near=Math.min(near,Math.abs(refs[o].hue-h));
  });
  if(!isFinite(near)) return 30;
  return Math.max(0.2,Math.min(30,near*0.45));
}
function effBand(refs,bands,k,fallback){
  return Math.min(bandFor(bands,k,fallback),bandCeiling(refs,k));
}

function matchStage(reading,refs,light,bands){
  const gap=ladderGap(refs);
  // if this frame's lighting is poorly determined, or the illuminant is far from
  // the one the chart was shot under, widen the window instead of guessing
  const lc=light&&light.ok?light.conf:0.5;
  const refCct=refs.green&&refs.green.cct?refs.green.cct:0;
  const cctDelta=(refCct&&light&&light.cct)?Math.abs(light.cct-refCct):0;
  const slack=1+Math.min(0.5,cctDelta/6000)+(1-lc)*0.25;

  const ds=Object.keys(refs).map(k=>{
    const rf=refs[k];
    const band=effBand(refs,bands,k)*slack;
    const raw=Math.abs(reading.hue-rf.hue);
    const sd=Math.abs((reading.spot||0)-(rf.spot||0));
    let d=Math.max(0,raw-band);                       // inside the band = dead on
    d=Math.sqrt(d*d+Math.pow(sd*0.22,2));
    let c=Math.sqrt(raw*raw+Math.pow(sd*0.22,2));     // distance to the CENTRE
    if(k==='spotty'&&reading.spot>18){d*=0.6;c*=0.6;} // heavy spotting is decisive
    if(k!=='spotty'&&reading.spot>26){d*=1.5;c*=1.5;}
    return {key:k,d:d,c:c,band:band};
  }).sort((p,q)=>(p.d-q.d)||(p.c-q.c));               // ties break on centre distance

  const d1=ds[0].d, d2=ds[1].d, c1=ds[0].c, c2=ds[1].c;
  const b1=ds[0].band;
  // Separation is judged on centre distance whenever the band distances tie —
  // otherwise two overlapping bands would both read as a perfect match and the
  // scanner could never reach its lock threshold.
  const sep=(d2-d1)>0.001?(d2-d1):(c2-c1);
  const tight=Math.max(0,1-d1/Math.max(b1*0.9,gap*0.6*slack));
  const margin=Math.min(1,sep/Math.max(b1*0.8,gap*0.5*slack));
  const framing=Math.min(1,reading.peelShare/0.38);
  const litFactor=0.82+0.18*lc;                       // unreadable lighting caps certainty
  return {key:ds[0].key, second:ds[1].key, blend:c1+c2>0?c1/(c1+c2):0, d1:d1, c1:c1, gap:gap,
    between:sep<gap*0.45*slack, light:light||null,
    inBand:d1===0, band:Math.round(b1*10)/10,
    conf:Math.max(0,Math.min(1,(tight*0.55+margin*0.45)*framing*litFactor))};
}

function readSource(src,sw,sh,wb,still,region){
  const S=180;
  const draw=(sx,sy,sw2,sh2)=>{
    const cv=document.createElement('canvas'); cv.width=S; cv.height=S;
    cv.getContext('2d').drawImage(src,sx,sy,sw2,sh2,0,0,S,S);
    return cv.getContext('2d').getImageData(0,0,S,S);
  };
  const side=Math.min(sw,sh);
  const scene=(still||region)?draw(0,0,sw,sh):draw((sw-side)/2,(sh-side)/2,side,side);
  const lit=estimateLighting(scene.data,S,S,!!still||!!region);   // lighting FIRST, always
  const gains=wb&&lit.ok?lit.gains:[1,1,1];
  const bias=(wb&&lit.ok&&lit.conf>0.45)?lit.bias:[0,0];          // weak estimate: correct gain only
  const target=region?draw(region[0]*sw,region[1]*sh,region[2]*sw,region[3]*sh):scene;
  const res=measurePeel(target.data,S,S,gains,bias,(still&&!region)?'still':(region?'all':'live'));
  res.light=lit;
  return res;
}


// ---- learned matcher: k-nearest neighbours over saved samples (from the SYC working model) ----
// Every sample is a handful of numbers measured by the same pipeline as a live scan.
// A new reading votes against its closest samples; light temperature is part of the distance.
const KEYS=['green','firm','ripe','spotty'];
function featDist(a,b){
  const dh=a.hue-b.hue, ds=((a.spot||0)-(b.spot||0))*0.22, dl=((a.L||0)-(b.L||0))*0.25, dc=((a.chroma||0)-(b.chroma||0))*0.2;
  const dk=(a.cct&&b.cct)?(a.cct-b.cct)/600:0;
  return Math.sqrt(dh*dh+ds*ds+dl*dl+dc*dc+dk*dk);
}
function knnMatch(reading,samples,k){
  const q={hue:reading.hue,spot:reading.spot,L:reading.L,chroma:reading.chroma,cct:reading.light&&reading.light.cct};
  const ds=samples.map(s=>({s,d:featDist(q,s)})).sort((a,b)=>a.d-b.d).slice(0,k);
  const w={};ds.forEach(x=>{w[x.s.stage]=(w[x.s.stage]||0)+(x.s.src==='auto'?0.6:1)/(x.d+0.6);});
  const ranked=Object.keys(w).sort((a,b)=>w[b]-w[a]);
  const tot=ranked.reduce((t,kk)=>t+w[kk],0)||1;
  const share=w[ranked[0]]/tot;
  const near=ds.filter(x=>x.s.stage===ranked[0]).reduce((m,x)=>Math.min(m,x.d),Infinity);
  const close=Math.max(0,Math.min(1,1-(near-2)/10));
  const framing=Math.min(1,(reading.peelShare==null?1:reading.peelShare)/0.38);
  const lc=reading.light&&reading.light.ok?reading.light.conf:0.5;
  return {key:ranked[0],second:ranked[1]||ranked[0],conf:Math.max(0,Math.min(1,share*close*framing*(0.82+0.18*lc))),
    between:share<0.6,knn:true,k:ds.length,votes:ds.filter(x=>x.s.stage===ranked[0]).length,d1:near,inBand:false,band:0};
}
function knnReady(samples,min){return KEYS.every(k=>samples.filter(s=>s.stage===k).length>=min);}

export { REFS, KEYS, readSource, matchStage, knnMatch, knnReady };
