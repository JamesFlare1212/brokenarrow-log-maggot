import { titleConditionMessages } from './title-conditions';

export const titleMessages: Record<string, readonly [string, string]> = {
  ...titleConditionMessages,
  matchTitles: ['本局称号', 'Match titles'],
  'title.glutton': ['大胃袋', 'Big Eater'],
  'title.glutton.tip': [
    '本局消耗补给资源 {n} 点，为未掉线玩家中最多。',
    'This match: consumed the most supply points among active players: {n}.',
  ],
  'title.deserter.silent': [
    '本局摧毁分与损失分均为 0。',
    'This match: zero destruction and loss scores.',
  ],
  'title.deserter.deserter': [
    '本局被标记为逃兵，最后有效出兵约在第 {min} 分钟，未达到对局时长的 85%。',
    'This match: flagged as a deserter; last recorded deployment around minute {min}, before 85% of the match.',
  ],
  'title.deserter.inactive': [
    '本局最后出兵约在第 {min} 分钟，早于对局时长的 40%，且摧毁不足队均的 15%。',
    'This match: last deployment around minute {min}, before 40% of the match, with destruction below 15% of the team average.',
  ],
  'title.carry': ['大腿', 'Carry'],
  'title.carry.tip': [
    '本局赢方净交换最高：摧毁 {d} − 损失 {l} = {net}。',
    'This match: highest winning-team net exchange: {d} destruction − {l} losses = {net}.',
  ],
  'title.blame': ['背锅侠', 'Scapegoat'],
  'title.blame.tip': [
    '本局输方净交换最低：摧毁 {d} − 损失 {l} = {net}。',
    'This match: lowest losing-team net exchange: {d} destruction − {l} losses = {net}.',
  ],
  'title.deserter': ['掉线狗', 'Deserter'],
  'title.deserter.tip': ['本局掉线或挂机。', 'This match: disconnected or inactive.'],
  'title.tryhard': ['带不动', 'Could Not Carry'],
  'title.tryhard.tip': [
    '本局虽然输了，净交换仍为全场第一：摧毁 {d} − 损失 {l} = {net}。',
    'This match: lost with the highest net exchange: {d} destruction − {l} losses = {net}.',
  ],
  'title.passenger': ['躺赢狗', 'Passenger'],
  'title.passenger.tip': [
    '本局获胜但净交换为负，且在未掉线玩家中垫底：{d} − {l} = {net}。',
    'This match: won with a negative net exchange, lowest among active players: {d} − {l} = {net}.',
  ],
  'title.lonewolf': ['孤勇者', 'Lone Hero'],
  'title.lonewolf.tip': [
    '本局队内 {n} 人掉线；净交换为本队第一、全场前三。',
    'This match: had {n} absent teammates; highest team net exchange and top three overall.',
  ],
  'title.reaper': ['收割机', 'Reaper'],
  'title.reaper.tip': [
    '本局摧毁分占全场 {p}%，为全场最高。',
    'This match: highest destruction share: {p}% of the match total.',
  ],
  'title.untouched': ['保活能手', 'Survivor'],
  'title.untouched.tip': [
    '本局摧毁为队均 {x} 倍，损失仅占本队 {p}%，在达标玩家中最低。',
    'This match: destruction is {x}× the team average; lowest qualifying team loss share at {p}%.',
  ],
  'title.weightlifter': ['举重冠军', 'Heavy Lifter'],
  'title.weightlifter.tip': [
    '本局击杀 {k} 个、阵亡 {d} 个单位，价值 K/D {kd}；击杀与阵亡占比均突出。',
    'This match: killed {k} units and lost {d}, value K/D {kd}; outstanding shares of both kills and deaths.',
  ],
  'title.atm': ['开送', 'Feeder'],
  'title.atm.tip': [
    '本局价值 K/D {kd}，损失分占全场 {p}%，在达标玩家中最高。',
    'This match: value K/D {kd}; highest qualifying share of match losses at {p}%.',
  ],
  'title.scraper': ['刮痧师傅', 'Scratch Damage'],
  'title.scraper.tip': [
    '本局摧毁仅为队均 {x} 倍，但伤害占全场 {p}%，在达标玩家中最高。',
    'This match: destruction is only {x}× the team average, with the highest qualifying damage share at {p}%.',
  ],
  'title.killsteal': ['抢人头', 'Kill Stealer'],
  'title.killsteal.tip': [
    '本局摧毁不低于队均，每点伤害换来 {x} 摧毁分，在达标玩家中最高。',
    'This match: at least average team destruction; highest qualifying efficiency at {x} destruction per damage.',
  ],
  'title.boxed': ['落地成盒', 'Instant Casualty'],
  'title.boxed.tip': [
    '本局至少阵亡 10 个单位，阵亡单位存活时间中位数 {s} 秒，为达标玩家中最短。',
    'This match: lost at least 10 units; shortest qualifying median unit lifetime at {s} seconds.',
  ],
  'title.camper': ['蹲逼', 'Camper'],
  'title.camper.tip': [
    '本局至少持续 10 分钟，摧毁为队均 {x} 倍；损失占本队 {p}%，在达标玩家中最低。',
    'This match: lasted at least 10 minutes; destruction is {x}× average and lowest qualifying team loss share is {p}%.',
  ],
  'title.landlord': ['地产大亨', 'Landlord'],
  'title.landlord.tip': [
    '本局占领 {n} 个点，占本队 {p}%，在达标玩家中最高。',
    'This match: captured {n} objectives, highest qualifying team share at {p}%.',
  ],
  'title.demolition': ['拆迁队', 'Demolition Crew'],
  'title.demolition.tip': [
    '本局拆毁 {n} 栋建筑，为全场最多。',
    'This match: destroyed the most buildings: {n}.',
  ],
  'title.convoy': ['运输大队长', 'Captured Convoy'],
  'title.convoy.tip': [
    '本局补给被敌方缴获 {n} 点，为全场最多（含掉线玩家）。',
    'This match: most supplies captured by enemies: {n}, including absent players.',
  ],
  'title.bandit': ['土匪', 'Bandit'],
  'title.bandit.tip': [
    '本局缴获敌方补给 {n} 点，为达标玩家中最多。',
    'This match: most enemy supplies captured among eligible players: {n}.',
  ],
  'title.canteen': ['奶妈', 'Team Supplier'],
  'title.canteen.tip': [
    '本局队友使用其提供的补给 {n} 点，为达标玩家中最多。',
    'This match: allies consumed {n} of their supplies, most among eligible players.',
  ],
  'title.freeloader': ['吃白食', 'Freeloader'],
  'title.freeloader.tip': [
    '本局使用队友补给 {n} 点，为达标玩家中最多。',
    'This match: consumed the most allied supplies among eligible players: {n}.',
  ],
  'title.courier': ['快递员', 'Courier'],
  'title.courier.tip': [
    '本局空投补给 {n} 点，为达标玩家中最多。',
    'This match: airdropped the most supplies among eligible players: {n}.',
  ],
  'title.refund': ['七天无理由退货', 'Refund Specialist'],
  'title.refund.tip': [
    '本局退款占出兵价值 {p}%，为达标玩家中最高。',
    'This match: highest qualifying refund share: {p}% of spawned unit value.',
  ],
  'title.spender': ['败家子', 'Big Spender'],
  'title.spender.tip': [
    '本局摧毁仅为队均 {x} 倍，出兵花费占全场 {p}%，在达标玩家中最高。',
    'This match: destruction is only {x}× the team average; highest qualifying spending share at {p}%.',
  ],
  'title.traitor': ['内鬼', 'Traitor'],
  'title.traitor.tip': [
    '本局误伤摧毁友军价值 {n}，为全场最高（含掉线玩家）。',
    'This match: highest friendly-fire destruction value: {n}, including absent players.',
  ],
  'title.backstabbed': ['被背刺', 'Backstabbed'],
  'title.backstabbed.tip': [
    '本局因友军误伤损失 {n} 分，为全场最高（含掉线玩家）。',
    'This match: highest losses to friendly fire: {n}, including absent players.',
  ],
  'title.crash': ['曼巴out', 'Air Crash'],
  'title.crash.tip': [
    '本局损失的直升机与飞机总价值 {n}，为达标玩家中最高。',
    'This match: highest qualifying value of lost helicopters and aircraft: {n}.',
  ],
  'title.artygod': ['大炮兵主义', 'Artillery Doctrine'],
  'title.artygod.tip': [
    '本局炮兵占出兵价值 {a}%，摧毁占全场 {p}%，在达标玩家中最高。',
    'This match: artillery is {a}% of spawned value; highest qualifying destruction share at {p}%.',
  ],
};
