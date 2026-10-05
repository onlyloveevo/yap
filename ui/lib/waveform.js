// Peak amplitude in equal time bins of the original PCM16 recording.
export function waveformPeaks(samples,count=420){
 if(!samples?.length)return [];
 const bins=Math.max(1,Math.min(Math.floor(count),samples.length));
 return Array.from({length:bins},(_,i)=>{
  const start=Math.floor(i*samples.length/bins),end=Math.floor((i+1)*samples.length/bins);let peak=0;
  for(let j=start;j<end;j++)peak=Math.max(peak,Math.abs(samples[j]));
  return Math.min(1,peak/32768);
 });
}
