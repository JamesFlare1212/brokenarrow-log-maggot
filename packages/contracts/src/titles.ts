export type MatchTitleId =
  | 'carry'
  | 'blame'
  | 'deserter'
  | 'tryhard'
  | 'passenger'
  | 'lonewolf'
  | 'reaper'
  | 'untouched'
  | 'weightlifter'
  | 'atm'
  | 'scraper'
  | 'killsteal'
  | 'boxed'
  | 'camper'
  | 'landlord'
  | 'demolition'
  | 'convoy'
  | 'bandit'
  | 'canteen'
  | 'freeloader'
  | 'courier'
  | 'refund'
  | 'spender'
  | 'traitor'
  | 'backstabbed'
  | 'crash'
  | 'artygod';

export interface MatchTitle {
  id: MatchTitleId;
  kind: 'good' | 'bad' | 'neutral';
  params: Record<string, string | number | boolean>;
}
