/**
 * `/` — the explainer.
 *
 * A static route. It reads no registry, holds no state of its own beyond which
 * beat is on screen, and renders the same drawings whether or not anything is
 * listening on port 8406. The live surface is `/app`.
 *
 * The two type families it introduced are now loaded in `app/layout.tsx` and
 * carry `/app` as well; the procedure that chose them is written out there.
 */
import { Explainer } from "../components/Explainer";

export default function LandingPage() {
  return <Explainer />;
}
