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
