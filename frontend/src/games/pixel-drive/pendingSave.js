const PREFIX="pixel-drive:pending-result:1:";
const scopePrefix=scope=>`${PREFIX}${encodeURIComponent(scope)}:`;
const keyFor=entry=>`${scopePrefix(entry.scope)}${encodeURIComponent(entry.sessionId)}`;
const samePayload=(left,right)=>left.scope===right.scope&&left.sessionId===right.sessionId&&left.version===right.version&&left.levelId===right.levelId&&JSON.stringify(left.payload)===JSON.stringify(right.payload);
const storage=()=>{
  try{if(globalThis.localStorage)return globalThis.localStorage;}catch(e){/* Report unavailable storage below. */}
  throw new Error("Браузер не дозволяє зберегти результат для повторної відправки. Не закривайте вкладку й спробуйте ще раз.");
};
function parse(raw,scope){
  const value=JSON.parse(raw);
  if(value?.schema!==1||value.scope!==scope||typeof value.id!=="string"||typeof value.sessionId!=="string"||!value.sessionId||
    !Number.isInteger(value.version)||!Number.isInteger(value.levelId)||value.levelId<1||!Number.isFinite(value.createdAt)||
    !Number.isInteger(value.payload?.ticks)||value.payload.ticks<1||typeof value.payload.abandon!=="boolean"||
    !["completed","failed"].includes(value.payload.outcome?.status)||"events" in value.payload){
    throw new Error("Незбережений результат у браузері пошкоджено. Новий заїзд поки недоступний, щоб не втратити попередній результат.");
  }
  return value;
}
export function readPendingSaves(scope){
  if(typeof scope!=="string"||!scope)throw new Error("Не вдалося визначити акаунт для збереження. Відкрийте гру ще раз.");
  const store=storage(),prefix=scopePrefix(scope),entries=[];
  for(let i=0;i<store.length;i++){
    const key=store.key(i);if(!key?.startsWith(prefix))continue;
    const raw=store.getItem(key);if(raw===null)continue;
    const value=parse(raw,scope);if(keyFor(value)!==key)throw new Error("Не вдалося прочитати попередній результат заїзду.");
    entries.push(value);
  }
  return entries.sort((a,b)=>a.createdAt-b.createdAt||a.sessionId.localeCompare(b.sessionId));
}
export function persistPendingSave(entry){
  const store=storage(),key=keyFor(entry),serialized=JSON.stringify(entry);parse(serialized,entry.scope);
  const existing=store.getItem(key);
  if(existing!==null){
    const previous=parse(existing,entry.scope);
    if(samePayload(previous,entry))return previous;
    throw new Error("У цій сесії вже є інший результат. Попередній запис збережено; відкрийте гру ще раз.");
  }
  try{
    store.setItem(key,serialized);
    if(store.getItem(key)!==serialized)throw new Error("write-not-retained");
  }catch(e){throw new Error("Не вдалося записати результат у браузері. Не закривайте вкладку; звільніть місце або дозвольте сховище й натисніть «Надіслати ще раз».");}
  return entry;
}
export function removePendingSave(entry){
  const store=storage(),key=keyFor(entry),raw=store.getItem(key);
  if(raw===null)return false;
  const current=parse(raw,entry.scope);
  // Acknowledging an older tab must never remove another session or replacement.
  if(current.id!==entry.id||!samePayload(current,entry))return false;
  store.removeItem(key);return true;
}
