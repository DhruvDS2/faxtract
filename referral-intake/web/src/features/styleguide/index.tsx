import { useLayoutEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import StyleguidePage from "./StyleguidePage";
import { MorphDetailPage } from "./MorphDetailPage";

/**
 * /__styleguide and /__styleguide/morph/:id in one lazy chunk, so the cross-route
 * shared-element target never waits on a network fetch.
 */
export default function Styleguide() {
  const rest = useParams()["*"] ?? "";
  const { hash } = useLocation();
  const morph = /^morph\/([^/]+)$/.exec(rest);
  // coming back from a morph detail: put the source list on screen before motion measures
  useLayoutEffect(() => {
    if (!morph && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [morph, hash]);
  return morph ? <MorphDetailPage id={morph[1]} /> : <StyleguidePage />;
}
