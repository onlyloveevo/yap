import { emptyReview } from './review-sample.js';
export const REVIEW_KEY='yap-review-proof-v1';
// Explicit browser adapter: no filesystem assumptions; failures never produce a fake saved message.
export function createReviewStore(storage){
 const check=REVIEW_KEY+'-probe';try{storage.setItem(check,'ok');if(storage.getItem(check)!=='ok')throw Error();storage.removeItem(check);}catch{throw Error('Review persistence unavailable; no trial can be saved');}
 return {load(){const text=storage.getItem(REVIEW_KEY);if(!text)return emptyReview();let v;try{v=JSON.parse(text);}catch{throw Error('Corrupt review data; refusing to silently reset');}if(v.version!==1||!['turns','trials','dismissed','forgotten'].every(k=>Array.isArray(v[k])))throw Error('Unsupported review data');return v;},save(state){const text=JSON.stringify(state);storage.setItem(REVIEW_KEY,text);if(storage.getItem(REVIEW_KEY)!==text)throw Error('Review save verification failed');return state;}};
}
