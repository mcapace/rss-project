import { Schedule } from "@/components/editorial/Schedule";

export default async function SchedulePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const month = typeof params.month === "string" ? params.month : undefined;
  return <Schedule key={month ?? "current"} initialMonth={month} />;
}
