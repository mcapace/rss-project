import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const require = createRequire(import.meta.url);
const reader = require("../../../public/wa/reader-core.js");

describe("reader persistence and honest rating filters", () => {
  it("round trips saves and pantry without changing other preferences", () => {
    const values = new Map<string,string>();
    const storage = {getItem:(k:string)=>values.get(k) || null,setItem:(k:string,v:string)=>values.set(k,v)};
    const state = reader.read(storage);
    state.shelf.push({kind:"bottle",slug:"ardbeg",title:"Ardbeg"});
    state.pantry.push("rye"); state.preferences={size:"1.3"};
    reader.write(storage,state);
    expect(reader.read(storage)).toEqual(state);
  });
  it("does not silently reset malformed or inaccessible storage", () => {
    expect(()=>reader.read({getItem:()=>"broken"})).toThrow();
    expect(()=>reader.read({getItem:()=>{throw Error("denied");}})).toThrow();
    const setItem=vi.fn(()=>{throw Error("quota");});
    expect(()=>reader.write({setItem},reader.empty())).toThrow("quota");
  });
  it("merges an exported shelf without replacing notes or other local state", () => {
    const current = {...reader.empty(), shelf:[{kind:"bottle",slug:"ardbeg",title:"Ardbeg",status:"owned",notes:"Peaty",savedAt:1}], pantry:["rye"], preferences:{size:"1.3"}};
    const incoming = {version:1,shelf:[{kind:"bottle",slug:"ardbeg",title:"Ardbeg",notes:"Different note"},{kind:"recipe",slug:"sour",title:"Whiskey Sour",notes:"Try with bourbon",savedAt:2}]};
    const next = reader.importShelf(JSON.stringify(incoming),current);
    expect(next.shelf).toHaveLength(2);
    expect(next.shelf[0]).toEqual(current.shelf[0]);
    expect(next.shelf[1].notes).toBe("Try with bourbon");
    expect(next.pantry).toEqual(["rye"]);
    expect(next.preferences).toEqual({size:"1.3"});
    expect(current.shelf).toHaveLength(1);
    expect(reader.importShelf(JSON.stringify(incoming), next).shelf).toHaveLength(2);
  });
  it("rejects a malformed or oversized import atomically", () => {
    for (const text of ['bad', JSON.stringify({version:2,shelf:[]}), JSON.stringify({version:1,shelf:[{kind:"bottle",slug:"ok",title:"Valid"},{kind:"script",slug:"bad",title:"Bad"}]}), ' '.repeat(2000001)]) expect(()=>reader.importShelf(text,reader.empty())).toThrow();
  });
  it("Any price and All scores include costly, low-scoring and unpriced entries", () => {
    for (const r of [{p:12000,s:97},{p:15,s:65},{p:0,s:90}]) expect(reader.matches(r,0,0)).toBe(true);
  });
  it("a price ceiling excludes unknown prices and respects the exact requested price", () => {
    expect(reader.matches({p:0,s:95},90,0)).toBe(false);
    expect(reader.matches({p:91,s:95},90,0)).toBe(false);
    expect(reader.matches({p:90,s:89},90,88)).toBe(true);
    expect(reader.matches({p:50,s:87},90,88)).toBe(false);
  });
  it("includes every real archived rating with no price or score filter", () => {
    const data=JSON.parse(readFileSync("public/wa/ratings.json","utf8"));
    const rows=data.rows.map((row:unknown[])=>Object.fromEntries(data.cols.map((key:string,i:number)=>[key,row[i]])));
    expect(rows.filter((r:unknown)=>reader.matches(r,0,0))).toHaveLength(rows.length);
    expect(rows.some((r:{p:number})=>r.p>400)).toBe(true);
  });
});
