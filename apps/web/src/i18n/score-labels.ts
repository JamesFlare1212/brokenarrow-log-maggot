export const scoreLabelMessages: Record<string, readonly [string, string]> = {
  scoreLabels: ['评分标签', 'Score labels'],
  'scoreLabels.short': ['评分', 'Scores'],
  'matchTitles.short': ['称号', 'Titles'],
  'scoreLabel.destruction': ['击杀王', 'Kill Leader'],
  'scoreLabel.damage': ['火力投送', 'Firepower'],
  'scoreLabel.dlRatio': ['爱兵如子', 'Survivor'],
  'scoreLabel.efficiency': ['精打细算', 'Efficient'],
  'scoreLabel.objectives': ['攻防专家', 'Objective Expert'],
  'scoreLabel.supply': ['奶妈', 'Team Supplier'],
  'scoreLabel.destruction.metric': ['摧毁评分', 'destruction score'],
  'scoreLabel.damage.metric': ['伤害评分', 'damage score'],
  'scoreLabel.dlRatio.metric': ['价值战损比评分', 'value exchange ratio score'],
  'scoreLabel.efficiency.metric': ['资源效率评分', 'resource efficiency score'],
  'scoreLabel.objectives.metric': ['占点评分', 'objective score'],
  'scoreLabel.supply.metric': ['补给评分', 'supply score'],
  'scoreLabel.destruction.evidence': [
    '击杀价值 {destructionValue} 点，击杀 {killed} 个单位。',
    'Destroyed {destructionValue} points of unit value; killed {killed} units.',
  ],
  'scoreLabel.damage.evidence': [
    '造成伤害 {damageDealt} 点，承受伤害 {damageReceived} 点。',
    'Dealt {damageDealt} damage and received {damageReceived} damage.',
  ],
  'scoreLabel.dlRatio.evidence': [
    '击杀价值 {destructionValue} 点，损失价值 {lossValue} 点，价值战损比 {dlRatio}。',
    'Destroyed value {destructionValue}; lost value {lossValue}; value exchange ratio {dlRatio}.',
  ],
  'scoreLabel.efficiency.evidence': [
    '出兵价值 {investment} 点，退款 {refunded} 点，击杀价值 {destructionValue} 点；资源回报率 {roi}。',
    'Deployed value {investment}; refunded {refunded}; destroyed value {destructionValue}; resource return {roi}.',
  ],
  'scoreLabel.objectives.evidence': [
    '占领 {objectivesCaptured} 个目标点。',
    'Captured {objectivesCaptured} objectives.',
  ],
  'scoreLabel.supply.evidence': [
    '队友使用其提供的补给 {supplyProvided} 点。',
    'Allies consumed {supplyProvided} points of this player’s supplies.',
  ],
  'scoreLabel.condition': [
    '完整终局，两队合评；{metric}最高且 > 0 者获评，并列取战报首位。',
    'Fully analyzed, completed match: highest positive {metric} across both teams; ties go to the first in report order.',
  ],
  'scoreLabel.limit': [
    '每人最多 {limit} 项，高分优先；超额不顺延。',
    'Up to {limit} per player, highest scores first; excess awards do not pass to others.',
  ],
  'scoreLabel.evidence.unavailable': [
    '未记录本局的相关战斗数值。',
    'The relevant combat values were not recorded for this match.',
  ],
};
