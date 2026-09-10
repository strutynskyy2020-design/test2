import {persistPendingSave,readPendingSaves,removePendingSave} from "./pendingSave";
const entry=(sessionId,scope="account-a")=>({schema:1,id:`record-${sessionId}`,scope,version:3,levelId:1,sessionId,createdAt:1,payload:{ticks:60,abandon:true,outcome:{status:"failed",reason:"abandoned",distance:20}}});
beforeEach(()=>localStorage.clear());
test("session records coexist across tabs and accounts; an acknowledgement removes only its own payload",()=>{
  const first=persistPendingSave(entry("one")),second=persistPendingSave(entry("two")),other=persistPendingSave(entry("three","account-b"));
  expect(readPendingSaves("account-a")).toEqual([first,second]);expect(readPendingSaves("account-b")).toEqual([other]);
  expect(removePendingSave(first)).toBe(true);expect(removePendingSave(first)).toBe(false);
  expect(readPendingSaves("account-a")).toEqual([second]);expect(readPendingSaves("account-b")).toEqual([other]);
});
test("a stale tab neither overwrites nor acknowledges a replaced session record",()=>{
  const old=persistPendingSave(entry("one")),key=localStorage.key(0);
  const newer={...old,id:"newer-record",payload:{...old.payload,outcome:{...old.payload.outcome,distance:30}}};
  localStorage.setItem(key,JSON.stringify(newer));
  expect(()=>persistPendingSave(old)).toThrow("інший результат");expect(removePendingSave(old)).toBe(false);
  expect(readPendingSaves("account-a")).toEqual([newer]);
});
test("duplicate persistence reuses the original identity for the same immutable payload",()=>{
  const original=persistPendingSave(entry("one"));
  expect(persistPendingSave({...original,id:"new-tab-id",createdAt:20})).toEqual(original);
  expect(readPendingSaves("account-a")).toHaveLength(1);
});
