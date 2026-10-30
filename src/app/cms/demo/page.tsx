import { DemoRedirect } from "@/components/editorial/DemoRedirect";

/** The demo lives at /cms?demo=1 so every page shares one shell; this keeps the old link working. */
export default function CmsDemoPage() {
  return <DemoRedirect />;
}
