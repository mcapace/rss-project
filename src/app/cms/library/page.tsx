import { Library } from "@/components/editorial/Library";

type Params = Record<string, string | string[] | undefined>;
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function LibraryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const params = await searchParams;
  const page = Number(one(params.page));
  return <Library key={`${one(params.brand)}:${one(params.issue)}`} initial={{
    kind: one(params.kind), state: one(params.state), q: one(params.q), sort: one(params.sort),
    dir: one(params.dir) === "asc" ? "asc" : undefined, page: Number.isInteger(page) && page > 1 ? page : 1, issue: one(params.issue) ?? null,
  }} />;
}
