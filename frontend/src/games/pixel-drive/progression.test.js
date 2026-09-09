const {CONFIG} = require('./engine');
const {freshProgress, migrateProgress, publicProgress, awardProgress, purchaseProgress} = require('./progression');
const outcome = (level, extra = {}) => ({status:'failed', reason:'fuel', distance:100, gears:[0,1], medals:[], checkpoints:[], ...extra});

test('ordinary coins return each run, checkpoints and finish pay only once', () => {
  const level = CONFIG.levels[0], run = outcome(level, {status:'completed', distance:level.meters, medals:['finish'], checkpoints:level.checkpoints.map(c => c.id)});
  const first = awardProgress(freshProgress(), level, run), next = awardProgress(first.progress, level, run);
  const coins = level.coinValues[0] + level.coinValues[1];
  expect(first.receipt.parts).toBe(coins + level.finishReward + level.checkpoints.reduce((s,c) => s+c.reward,0));
  expect(next.receipt.parts).toBe(coins);
  expect(next.receipt.finish_parts).toBe(0); expect(next.receipt.checkpoint_parts).toBe(0);
  expect(next.progress.tracks['1'].attempts).toBe(2); expect(next.receipt.new_record).toBe(false);
  expect(publicProgress(next.progress).unlocked_level).toBe(2);
});
test('a failed run keeps coins and checkpoints without awarding a finish', () => {
  const level = CONFIG.levels[1], ids = level.checkpoints.slice(0,1).map(c => c.id);
  const result = awardProgress(freshProgress(), level, outcome(level, {checkpoints:ids}));
  expect(result.receipt.parts).toBe(level.coinValues[0]+level.coinValues[1]+(level.checkpoints[0]?.reward||0));
  expect(result.receipt.finish_parts).toBe(0); expect(result.receipt.new_record).toBe(true);
});
test('repeated pickup indices in one outcome cannot multiply coins', () => {
  const level = CONFIG.levels[0], result = awardProgress(freshProgress(), level, outcome(level,{gears:[0,0,1,1]}));
  expect(result.receipt.parts).toBe(level.coinValues[0]+level.coinValues[1]);
});
test('all 40 purchases use the configured curve and keep the vehicle alias consistent', () => {
  let profile = freshProgress(); profile.balance = 1000000;
  let spent = 0;
  for (const part of CONFIG.parts) for (let level=0;level<10;level++) {
    const result = purchaseProgress(profile,part,level); profile = result.progress;
    expect(result.purchase.price).toBe(CONFIG.upgradePrices[part][level]); spent += result.purchase.price;
    expect(profile.vehicles.wanderer.upgrades).toEqual(profile.upgrades);
  }
  expect(profile.balance).toBe(1000000-spent);
  expect(() => purchaseProgress(profile,'engine',10)).toThrow();
});
test.each([1,2])('v%s migration preserves paid parts and balance while granting tutorial credit once', version => {
  const old = {version,balance:125,upgrades:{engine:5,suspension:3,tires:2,tank:1},tracks:{'4':{best:1200,medals:['finish'],gears:[0,1]}}};
  const migrated = migrateProgress(old);
  expect(migrated.balance).toBe(125+CONFIG.levels[0].finishReward);
  expect(migrated.upgrades).toEqual({engine:4,suspension:2,tires:1,tank:0});
  expect(migrated.legacy.tracks).toEqual(old.tracks); expect(migrated.tracks['1'].medals).toEqual([]);
  expect(publicProgress(migrated).unlocked_level).toBe(2); expect(migrateProgress(migrated)).toEqual(migrated);
  const result = awardProgress(migrated,CONFIG.levels[0],outcome(CONFIG.levels[0],{status:'completed',medals:['finish']}));
  expect(result.receipt.finish_parts).toBe(0);
});
