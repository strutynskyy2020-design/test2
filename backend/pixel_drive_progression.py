"""Pure Python garage economy. No physics replay or Node on production routes."""
from copy import deepcopy
import json
import math
from pathlib import Path

CONFIG = json.loads(Path(__file__).with_name('pixel_drive_config.json').read_text(encoding='utf-8'))
LEGACY_CONFIG = json.loads(Path(__file__).with_name('pixel_drive_config_v3.json').read_text(encoding='utf-8'))
SCHEMA, VEHICLE = 4, 'wanderer'
PARTS = ('engine', 'suspension', 'tires', 'tank')
WORLD_IDS = ('earth', 'moon', 'mars', 'basalt')
MAX_SAFE_INTEGER = 2**53-1
REQUIREMENTS = {1:[],2:[1],3:[2],4:[3],5:[4],6:[5],7:[6],8:[4],9:[8],10:[9],11:[9,6],12:[11],13:[12],14:[12],15:[14],16:[15]}
ENDLESS_MILESTONES = {1000:100,3000:200,5000:300,10000:500}

def _integer(value, low, high=MAX_SAFE_INTEGER):
    return type(value) in (int,float) and low <= value <= high and value == int(value)

def vehicle_config(vehicle_id):
    return next((v for v in CONFIG.get('vehicles',[dict(id=VEHICLE,price=0,fuel=[40,80])]) if v['id']==vehicle_id),None)

def fuel_capacity(vehicle_id, rank):
    vehicle = vehicle_config(vehicle_id)
    if not vehicle: raise ValueError('Невідома машина')
    return vehicle['fuel'][0]+(vehicle['fuel'][1]-vehicle['fuel'][0])*rank/10

def _level(level_id, version=None):
    levels = LEGACY_CONFIG['levels'] if version == 3 else CONFIG['levels']
    if type(level_id) is not int or not 1 <= level_id <= len(levels): raise ValueError('Невідома траса')
    return levels[level_id-1]

def fresh_upgrades(): return {part:0 for part in PARTS}
def fresh_vehicle(upgrades=None): return dict(upgrades=deepcopy(upgrades if upgrades is not None else fresh_upgrades()), records=dict(campaign={},endless={}))
def fresh_track(): return dict(gears=[],medals=[],checkpoints=[],best=0,attempts=0,finish_reward_claimed=False)
def fresh_progress():
    upgrades=fresh_upgrades()
    return dict(profile_schema=SCHEMA,vehicle_id=VEHICLE,balance=0,upgrades=upgrades,vehicles={VEHICLE:fresh_vehicle(upgrades)},
                tracks={},endless={},tutorial_granted=False,migration=None,purchases={})

def migrate_progress(before):
    if before.get('profile_schema')==SCHEMA: return deepcopy(before)
    upgrades=before.get('upgrades')
    if before.get('profile_schema')==3:
        if not _integer(before.get('balance'),0) or not isinstance(upgrades,dict) or not all(_integer(upgrades.get(p),0,10) for p in PARTS):
            raise ValueError('Некоректне попереднє збереження')
        result=deepcopy(before)
        result.update(profile_schema=SCHEMA,vehicle_id=VEHICLE,endless={},vehicles={VEHICLE:fresh_vehicle(upgrades)})
        result['vehicles'][VEHICLE]['records']['campaign']={key:dict(best=t['best'],attempts=t.get('attempts',0),medals=deepcopy(t.get('medals',[]))) for key,t in result.get('tracks',{}).items()}
        result['migration']=dict(from_version=3,tutorial_credit=0,previous=deepcopy(before.get('migration')))
        return result
    if not _integer(before.get('balance'),0) or not isinstance(upgrades,dict) or not all(_integer(upgrades.get(p),1,5) for p in PARTS):
        raise ValueError('Некоректне попереднє збереження')
    credit=CONFIG['levels'][0]['finishReward']
    result=deepcopy(before);result.update(fresh_progress())
    old_version=before.get('version') or 'pre-3'
    result['legacy']=dict(version=old_version,balance=before['balance'],upgrades=deepcopy(upgrades),tracks=deepcopy(before.get('tracks') or {}),purchases=deepcopy(before.get('purchases') or {}))
    result['balance']=before['balance']+credit
    result['upgrades']={p:upgrades[p]-1 for p in PARTS};result['vehicles'][VEHICLE]=fresh_vehicle(result['upgrades'])
    result['tutorial_granted']=True;result['migration']=dict(from_version=old_version,tutorial_credit=credit)
    result['tracks']['1']=dict(fresh_track(),finish_reward_claimed=True);result.pop('rewards',None)
    return result

def unlocked_levels(profile):
    def complete(n): return n==1 and profile.get('tutorial_granted') or 'finish' in profile['tracks'].get(str(n),{}).get('medals',[])
    return [l['id'] for l in CONFIG['levels'] if all(complete(n) for n in REQUIREMENTS.get(l['id'],[]))]

def unlocked_worlds(profile):
    levels=unlocked_levels(profile)
    return [w for index,w in enumerate(WORLD_IDS) if index==0 or (1,8,11,14)[index] in levels]

def public_progress(profile):
    selected=profile.get('vehicle_id',VEHICLE)
    return dict(version=CONFIG['version'],profile_schema=SCHEMA,vehicle_id=selected,balance=profile['balance'],
                upgrades=deepcopy(profile['vehicles'][selected]['upgrades']),vehicles=deepcopy(profile['vehicles']),tracks=deepcopy(profile['tracks']),endless=deepcopy(profile.get('endless',{})),
                tutorial_granted=bool(profile.get('tutorial_granted')),migration=deepcopy(profile.get('migration')),
                unlocked_level=max(n for n in unlocked_levels(profile) if n<=7),unlocked_levels=unlocked_levels(profile),unlocked_worlds=unlocked_worlds(profile),
                levels=[{k:l[k] for k in ('id','name','meters','hint','recommended','stageId','worldId','seed','generatorVersion') if k in l} for l in CONFIG['levels']])

def award_progress(before, level_id, outcome, metadata=None):
    metadata=metadata or {};level=_level(level_id,metadata.get('version'))
    if not _integer(before.get('balance'),0) or outcome.get('status') not in ('completed','failed'): raise ValueError('Некоректний результат')
    vehicle_id=metadata.get('vehicle_id') or outcome.get('vehicleId') or VEHICLE
    if vehicle_id not in before['vehicles']: raise ValueError('Машину не придбано')
    if metadata.get('mode')=='endless': return award_endless(before,outcome,dict(metadata,vehicle_id=vehicle_id))
    raw_gears=outcome.get('gears') or [];raw_checkpoints=outcome.get('checkpoints') or []
    checkpoint_rewards={c['id']:c['reward'] for c in level['checkpoints']}
    if not isinstance(raw_gears,list) or not isinstance(raw_checkpoints,list) or any(not _integer(n,0,len(level['gears'])-1) for n in raw_gears) or any(not isinstance(n,str) or n not in checkpoint_rewards for n in raw_checkpoints) or not _integer(outcome.get('distance'),0,level['meters']):
        raise ValueError('Некоректні нагороди')
    gears=list(dict.fromkeys(int(n) for n in raw_gears));checkpoints=list(dict.fromkeys(raw_checkpoints))
    result=deepcopy(before);key=str(level['id']);track=result['tracks'].get(key) or fresh_track();previous=track['best']
    new_checkpoints=[n for n in checkpoints if n not in track['checkpoints']]
    new_medals=[n for n in (outcome.get('medals') or []) if n not in track['medals']]
    coin_parts=sum(level['coinValues'][n] for n in gears);checkpoint_parts=sum(checkpoint_rewards[n] for n in new_checkpoints)
    finish_parts=level['finishReward'] if outcome['status']=='completed' and not track.get('finish_reward_claimed') else 0
    parts=coin_parts+checkpoint_parts+finish_parts
    if not _integer(parts,0) or not _integer(result['balance']+parts,0): raise ValueError('Некоректна сума нагороди')
    result['balance']+=parts;track['gears']=sorted(set(track['gears']+gears));track['medals']=sorted(set(track['medals']+new_medals));track['checkpoints']=sorted(set(track['checkpoints']+checkpoints))
    track['best']=max(previous,outcome['distance']);track['attempts']=(track.get('attempts') or 0)+1
    if outcome['status']=='completed':track['finish_reward_claimed']=True
    result['tracks'][key]=track
    records=result['vehicles'][vehicle_id].setdefault('records',dict(campaign={},endless={}))
    record=records['campaign'].get(key) or dict(best=0,attempts=0,medals=[])
    record['best']=max(record['best'],outcome['distance']);record['attempts']+=1;record['medals']=sorted(set(record['medals']+(outcome.get('medals') or [])));records['campaign'][key]=record
    return result,dict(parts=parts,coin_parts=coin_parts,checkpoint_parts=checkpoint_parts,finish_parts=finish_parts,new_medals=sorted(new_medals),new_gears=len(gears),new_checkpoints=sorted(new_checkpoints),new_record=outcome['distance']>previous,previous_best=previous)

def award_endless(before,outcome,metadata):
    world=metadata.get('world_id');distance=outcome.get('distance')
    if world not in WORLD_IDS or not _integer(distance,0,1000000000): raise ValueError('Некоректні нагороди')
    result=deepcopy(before);track=result['endless'].get(world) or dict(best=0,attempts=0,milestones=[]);previous=track['best']
    milestones=[n for n in ENDLESS_MILESTONES if n<=distance and n not in track['milestones']]
    collected=outcome.get('coinsCollected',0);collected=collected if _integer(collected,0) else 0
    coin_parts=min(collected,math.floor((distance+12)/25))*5;checkpoint_parts=sum(ENDLESS_MILESTONES[n] for n in milestones);parts=coin_parts+checkpoint_parts
    if not _integer(result['balance']+parts,0): raise ValueError('Некоректна сума нагороди')
    result['balance']+=parts;track['best']=max(previous,distance);track['attempts']+=1;track['milestones']=sorted(set(track['milestones']+milestones));result['endless'][world]=track
    records=result['vehicles'][metadata['vehicle_id']]['records'];record=records['endless'].get(world) or dict(best=0,attempts=0,milestones=[])
    record['best']=max(record['best'],distance);record['attempts']+=1;record['milestones']=[n for n in ENDLESS_MILESTONES if n<=record['best']];records['endless'][world]=record
    return result,dict(parts=parts,coin_parts=coin_parts,checkpoint_parts=checkpoint_parts,finish_parts=0,new_medals=[],new_gears=0,new_checkpoints=[str(n) for n in milestones],new_record=distance>previous,previous_best=previous)

def upgrade_price(part,rank,vehicle_id=VEHICLE):
    return math.floor(CONFIG['upgradePrices'][part][rank]*vehicle_config(vehicle_id).get('upgradeCostFactor',1)+.5)

def purchase_progress(before,part,from_level,vehicle_id=None):
    vehicle_id=vehicle_id or before.get('vehicle_id',VEHICLE)
    if vehicle_id not in before['vehicles']: raise ValueError('Машину не придбано')
    current=before['vehicles'][vehicle_id]['upgrades'].get(part) if isinstance(part,str) else None
    if part not in PARTS or not _integer(from_level,0,9) or current!=from_level: raise ValueError('Рівень покращення змінився')
    price=upgrade_price(part,int(from_level),vehicle_id)
    if before['balance']<price: raise ValueError('Недостатньо монет')
    result=deepcopy(before);result['balance']-=price;result['vehicles'][vehicle_id]['upgrades'][part]+=1
    result['upgrades']=deepcopy(result['vehicles'][result.get('vehicle_id',VEHICLE)]['upgrades'])
    return result,dict(part=part,**{'from':from_level},to=from_level+1,price=price,vehicle_id=vehicle_id)

def purchase_vehicle(before,vehicle_id):
    vehicle=vehicle_config(vehicle_id)
    if not vehicle: raise ValueError('Невідома машина')
    if vehicle_id in before['vehicles']: raise ValueError('Машину вже придбано')
    if not _integer(vehicle['price'],0) or before['balance']<vehicle['price']: raise ValueError('Недостатньо монет')
    result=deepcopy(before);result['balance']-=vehicle['price'];result['vehicles'][vehicle_id]=fresh_vehicle();result['vehicle_id']=vehicle_id;result['upgrades']=deepcopy(result['vehicles'][vehicle_id]['upgrades'])
    return result,dict(kind='vehicle',vehicle_id=vehicle_id,price=vehicle['price'])

def select_vehicle(before,vehicle_id):
    if vehicle_id not in before['vehicles']: raise ValueError('Машину не придбано')
    result=deepcopy(before);result['vehicle_id']=vehicle_id;result['upgrades']=deepcopy(result['vehicles'][vehicle_id]['upgrades'])
    return result,dict(kind='select',vehicle_id=vehicle_id,price=0)
