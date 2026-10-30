import { Suspense } from "react";
import { LegacyReader } from "@/components/editorial/LegacyReader";

export default function FeedReaderPage() {
  return <Suspense fallback={null}><LegacyReader /></Suspense>;
}
