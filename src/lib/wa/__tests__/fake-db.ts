/**
 * A small in-memory stand-in for the supabase-js client, for tests that must never reach a database. It applies the
 * filters the public routes use (eq, neq, in, is, not is, lte, gte, lt, gt, ilike, or, including filters on an
 * embedded relation such as cms_documents!inner) to fixture rows, and answers rpc calls from handlers. Selects are not
 * parsed: fixture rows already carry every field (and alias) the code reads. `maxRows` caps every response the way
 * PostgREST does (1,000 rows on the real API, whatever limit or range asks for).
 */
type Row = Record<string, unknown>;
type Pred = (row: Row) => boolean;
export type RpcCall = { name: string; args: Record<string, unknown> };
export type FromCall = { table: string; filters: string[] };

function read(row: unknown, column: string): unknown {
  let value: unknown = row;
  for (const part of column.split(/->>?/)) {
    if (value == null || typeof value !== "object") return undefined;
    value = (value as Row)[part];
  }
  return value;
}

function compare(a: unknown, b: unknown): number {
  const x = typeof a === "string" ? Date.parse(a) : NaN, y = typeof b === "string" ? Date.parse(b) : NaN;
  if (Number.isFinite(x) && Number.isFinite(y) && /\d{4}-\d{2}-\d{2}/.test(String(a)) && /\d{4}-\d{2}-\d{2}/.test(String(b))) return x - y;
  if (typeof a === "number" || typeof b === "number") return Number(a) - Number(b);
  return String(a).localeCompare(String(b));
}

function like(pattern: string): RegExp {
  const lit = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let body = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\" && i + 1 < pattern.length) body += lit(pattern[++i]);
    else body += c === "%" ? ".*" : c === "_" ? "." : lit(c);
  }
  return new RegExp(`^${body}$`, "i");
}

function test(op: string, actual: unknown, value: unknown): boolean {
  switch (op) {
    case "eq": return actual === value || (actual != null && String(actual) === String(value));
    case "neq": return !(actual === value || (actual != null && String(actual) === String(value)));
    case "is": return value === null || value === "null" ? actual == null : actual === value;
    case "lte": return actual != null && compare(actual, value) <= 0;
    case "lt": return actual != null && compare(actual, value) < 0;
    case "gte": return actual != null && compare(actual, value) >= 0;
    case "gt": return actual != null && compare(actual, value) > 0;
    case "ilike": return typeof actual === "string" && like(String(value)).test(actual);
    default: throw new Error(`fake db: unsupported operator ${op}`);
  }
}

/** "a.is.null,b.lte.2026-01-01T00:00:00.000Z" as one predicate (any term true). */
function orPredicate(filters: string): Pred {
  const terms = filters.split(",").map(term => {
    const m = /^(.+?)\.(eq|neq|is|lte|lt|gte|gt|ilike)\.(.*)$/.exec(term);
    if (!m) throw new Error(`fake db: cannot read or term ${term}`);
    return { column: m[1], op: m[2], value: m[3] === "null" ? null : m[3] };
  });
  return row => terms.some(t => test(t.op, read(row, t.column), t.value));
}

class FakeQuery implements PromiseLike<{ data: unknown; error: null }> {
  private preds: Pred[] = [];
  private joined = new Map<string, Pred[]>();
  private take: number | null = null;
  private skip = 0;
  private one: "maybe" | "single" | null = null;
  constructor(private rows: Row[], private call: FromCall, private maxRows = Infinity) {}

  private add(column: string, pred: (value: unknown) => boolean, label: string) {
    this.call.filters.push(label);
    const dot = column.indexOf(".");
    if (dot > 0 && !column.includes("->")) {
      const relation = column.slice(0, dot), field = column.slice(dot + 1);
      this.joined.set(relation, [...(this.joined.get(relation) ?? []), row => pred(read(row, field))]);
    } else this.preds.push(row => pred(read(row, column)));
    return this;
  }
  select(columns?: string) { this.call.filters.push(`select:${columns ?? "*"}`); return this; }
  eq(column: string, value: unknown) { return this.add(column, v => test("eq", v, value), `eq:${column}=${String(value)}`); }
  neq(column: string, value: unknown) { return this.add(column, v => test("neq", v, value), `neq:${column}=${String(value)}`); }
  in(column: string, values: unknown[]) { return this.add(column, v => values.some(x => test("eq", v, x)), `in:${column}`); }
  is(column: string, value: unknown) { return this.add(column, v => test("is", v, value), `is:${column}=${String(value)}`); }
  not(column: string, op: string, value: unknown) { return this.add(column, v => !test(op, v, value), `not:${column}.${op}.${String(value)}`); }
  lte(column: string, value: unknown) { return this.add(column, v => test("lte", v, value), `lte:${column}`); }
  lt(column: string, value: unknown) { return this.add(column, v => test("lt", v, value), `lt:${column}`); }
  gte(column: string, value: unknown) { return this.add(column, v => test("gte", v, value), `gte:${column}`); }
  gt(column: string, value: unknown) { return this.add(column, v => test("gt", v, value), `gt:${column}`); }
  ilike(column: string, pattern: string) { return this.add(column, v => test("ilike", v, pattern), `ilike:${column}`); }
  or(filters: string, options: { referencedTable?: string } = {}) {
    this.call.filters.push(`or:${options.referencedTable ? options.referencedTable + ":" : ""}${filters}`);
    const pred = orPredicate(filters);
    if (options.referencedTable) this.joined.set(options.referencedTable, [...(this.joined.get(options.referencedTable) ?? []), pred]);
    else this.preds.push(pred);
    return this;
  }
  order() { return this; }
  limit(n: number) { this.take = n; return this; }
  range(from: number, to: number) { this.skip = from; this.take = to - from + 1; return this; }
  maybeSingle() { this.one = "maybe"; return this; }
  single() { this.one = "single"; return this; }

  private result() {
    let out = this.rows.filter(row => this.preds.every(p => p(row)));
    // An embedded filter keeps only parents whose relation passes, as cms_documents!inner does.
    for (const [relation, preds] of this.joined) {
      out = out.filter(row => {
        const nested = row[relation];
        const list = (Array.isArray(nested) ? nested : nested ? [nested] : []) as Row[];
        return list.some(item => preds.every(p => p(item)));
      });
    }
    out = out.slice(this.skip, this.take == null ? undefined : this.skip + this.take).slice(0, this.maxRows);
    if (this.one) return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
  then<A = { data: unknown; error: null }, B = never>(resolve?: ((value: { data: unknown; error: null }) => A | PromiseLike<A>) | null, reject?: ((reason: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve(this.result()).then(resolve, reject);
  }
}

export function fakeDb(tables: Record<string, Row[]>, rpcs: Record<string, (args: Record<string, unknown>) => unknown> = {}, options: { maxRows?: number } = {}) {
  const rpcCalls: RpcCall[] = [];
  const fromCalls: FromCall[] = [];
  return {
    rpcCalls, fromCalls,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args });
      if (name === "wa_rate_hit" && !rpcs[name]) return { data: true, error: null };
      const handler = rpcs[name];
      if (!handler) return { data: null, error: { message: `fake db: no rpc ${name}` } };
      // A handler throws a { code, message } object to answer as a database error (for example PGRST202).
      try { return { data: handler(args), error: null }; } catch (error) { return { data: null, error: error as { code?: string; message: string } }; }
    },
    from: (table: string) => {
      const call: FromCall = { table, filters: [] };
      fromCalls.push(call);
      return new FakeQuery(tables[table] ?? [], call, options.maxRows);
    },
  };
}

/** Times relative to the test's clock. */
export const past = (days = 1) => new Date(Date.now() - days * 864e5).toISOString();
export const future = (days = 1) => new Date(Date.now() + days * 864e5).toISOString();
