export type ScoreWindow=4|2|1
export function currentScoreAt(tSec:number, firstWrongAtAny?:boolean):ScoreWindow{
  if(tSec<20 && !firstWrongAtAny) return 4; if(tSec<40) return 2; return 1
}