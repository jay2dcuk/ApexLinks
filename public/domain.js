export const holes=[4,4,3,5,4,4,3,5,4,4,3,5,4,4,3,4,5,4];
export function result(scores){return scores.reduce((r,s,i)=>s===null?r:r+s-holes[i],0);}
export function scoreLabel(n){return n===0?'E':n>0?'+'+n:String(n);}
export function stableford(scores,handicap){return scores.reduce((total,s,i)=>s===null?total:total+Math.max(0,2+holes[i]+Math.floor(handicap/18)+(i<handicap%18?1:0)-s),0);}
export function validateScore(value){return Number.isInteger(value)&&value>=1&&value<=20;}
