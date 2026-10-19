export const titleConditionMessages: Record<string, readonly [string, string]> = {
  'title.glutton.condition': [
    '补给消耗 > 0，且为符合条件玩家中最多。',
    'Highest positive supply consumption among eligible players.',
  ],
  'title.condition.heading': ['判定条件', 'Award conditions'],
  'title.condition.evidence': ['本局依据', 'Match evidence'],
  'title.condition.active': [
    '终局 ≥ 8 分钟；未掉线或挂机。',
    'Completed match ≥ 8 min; no absence or inactivity.',
  ],
  'title.condition.all': [
    '已结束对局，含掉线玩家；不限时长。',
    'Completed match, any duration; absent players included.',
  ],
  'title.condition.best': [
    '达标者中取最优；并列取战报首位。',
    'Best eligible value; ties go to the first in report order.',
  ],
  'title.condition.limit': [
    '每人最多 {limit} 个，稀有优先；掉线优先。',
    'Up to {limit} per player by rarity; absence first.',
  ],
  'title.condition.net': [
    '净交换 = 摧毁分 − 损失分。',
    'Net exchange = destruction score − loss score.',
  ],
  'title.condition.netWeighted': [
    '净交换 = 摧毁分 − 损失分 + {objectiveValue} × 占点数。',
    'Net exchange = destruction − losses + {objectiveValue} × objectives.',
  ],
  'title.carry.condition': [
    '胜方未掉线玩家中净交换最高，可为负。',
    'Known winner; highest net exchange among active winners, even if negative.',
  ],
  'title.blame.condition': [
    '败方无人掉线，且净交换本队最低。',
    'Known winner, no absent players on the losing team; lowest losing-team net exchange.',
  ],
  'title.deserter.condition': [
    '满足其一：摧毁与损失均为 0；逃兵标记且末次出兵未知或早于全局 85%；末次出兵早于 40% 且摧毁 < 队均 15%。',
    'Any of: zero destruction and loss scores; deserter flag with unknown last deployment or last deployment before 85% of duration; last deployment before 40% with destruction below 15% of team average.',
  ],
  'title.tryhard.condition': [
    '败方未掉线，净交换全场第一。',
    'Known winner; an active losing player ranks first overall in net exchange.',
  ],
  'title.passenger.condition': [
    '胜方未掉线、非本队大腿；净交换为负且为全场未掉线玩家中最低。',
    'Known winner; active winner other than the team carry, with negative net exchange and last place among all active players.',
  ],
  'title.lonewolf.condition': [
    '队友有人掉线；本人未掉线，净交换本队第一、全场前三。',
    'At least one absent teammate; active player with highest team net exchange and top three overall.',
  ],
  'title.reaper.condition': [
    '全场摧毁占比 ≥ {percent}%。',
    'Share of total destruction score ≥ {percent}%.',
  ],
  'title.untouched.condition': [
    '摧毁 ≥ 队均，本队损失占比 ≤ {percent}%。',
    'Destruction at least the team average; team loss share ≤ {percent}%.',
  ],
  'title.weightlifter.condition': [
    '全场击杀、阵亡占比均 ≥ {percent}%；价值 K/D 为 0.75–1.33（含）。',
    'Both kill and death shares ≥ {percent}% of match totals; destruction/loss score ratio from 0.75 to 1.33 inclusive.',
  ],
  'title.atm.condition': [
    '全场损失占比 ≥ {percent}%，价值 K/D < 0.5。',
    'Share of total losses ≥ {percent}%; destruction/loss score ratio < 0.5.',
  ],
  'title.scraper.condition': [
    '全场伤害占比 ≥ {percent}%，摧毁 < 队均 80%。',
    'Share of total damage ≥ {percent}%; destruction below 80% of team average.',
  ],
  'title.killsteal.condition': [
    '摧毁 ≥ 队均，伤害 > 0，摧毁 / 伤害 ≥ {threshold}。',
    'Destruction at least team average, damage > 0, and destruction score/damage ≥ {threshold}.',
  ],
  'title.boxed.condition': [
    '阵亡 ≥ 10 个单位，有效生存记录 ≥ 8 条；生存中位数 ≤ {threshold} 秒。',
    'At least 10 unit deaths and 8 valid lifetime records; median lifetime ≤ {threshold} seconds.',
  ],
  'title.camper.condition': [
    '对局 ≥ 10 分钟，摧毁 ≤ 队均 50%，本队损失占比 ≤ {percent}%。',
    'Match lasts at least 10 minutes; destruction ≤ 50% of team average and team loss share ≤ {percent}%.',
  ],
  'title.landlord.condition': [
    '占点 ≥ 3；本队占点占比（0–1）+ 占点数 / 1000 ≥ {threshold}。',
    'At least 3 objectives; team objective share (0–1) + objective count/1000 ≥ {threshold}.',
  ],
  'title.demolition.condition': [
    '拆毁建筑数 + 摧毁分 / 10000000 ≥ {threshold}。',
    'Buildings destroyed + destruction score/10000000 ≥ {threshold}.',
  ],
  'title.convoy.condition': [
    '被敌方缴获的补给 ≥ {threshold} 点。',
    'Supplies captured by enemies ≥ {threshold}.',
  ],
  'title.bandit.condition': [
    '缴获敌方补给 ≥ {threshold} 点。',
    'Enemy supplies captured ≥ {threshold}.',
  ],
  'title.canteen.condition': [
    '队友消耗本人的补给 ≥ {threshold} 点。',
    'Own supplies consumed by allies ≥ {threshold}.',
  ],
  'title.freeloader.condition': [
    '本人消耗队友补给 ≥ {threshold} 点。',
    'Allied supplies consumed ≥ {threshold}.',
  ],
  'title.courier.condition': ['空投补给 ≥ {threshold} 点。', 'Airdropped supplies ≥ {threshold}.'],
  'title.refund.condition': [
    '退款价值 / 总出兵价值 ≥ {percent}%。',
    'Refunded value/total spawned value ≥ {percent}%.',
  ],
  'title.spender.condition': [
    '出兵价值占全场比例 ≥ {percent}%，且摧毁低于队均的 70%。',
    'Share of total spawned value ≥ {percent}%; destruction below 70% of team average.',
  ],
  'title.traitor.condition': [
    '友军击杀价值 ≥ {threshold}。',
    'Friendly-fire destruction value ≥ {threshold}.',
  ],
  'title.backstabbed.condition': [
    '被友军击杀的损失价值 ≥ {threshold}。',
    'Value lost to friendly fire ≥ {threshold}.',
  ],
  'title.crash.condition': [
    '损失的直升机、固定翼飞机基础价值合计 ≥ {threshold}。',
    'Total base unit value of destroyed helicopters and fixed-wing aircraft ≥ {threshold}.',
  ],
  'title.artygod.condition': [
    '全场摧毁占比 ≥ {percent}%；已识别单位基础价值中，火炮占比 ≥ 30%。',
    'Share of total destruction ≥ {percent}%; artillery is at least 30% of identified unit base value.',
  ],
};
