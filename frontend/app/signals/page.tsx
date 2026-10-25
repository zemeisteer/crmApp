import { redirect } from "next/navigation";

// Signals live on the AI insights page now; old links land there.
export default function SignalsPage() {
  redirect("/ai-insights?tab=signals");
}
