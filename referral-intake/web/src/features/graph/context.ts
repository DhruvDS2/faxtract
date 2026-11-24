import { createContext, useContext } from "react";
import type { Reveal } from "./reveal";

/**
 * Hover / selection shared by the map, the side panel and the trace timeline, so
 * hovering a timeline bar highlights its step and the other way round. Kept out of
 * React Flow's node data so a hover doesn't rebuild the nodes.
 */
export type GraphInteraction = {
  selected: string | null;
  hovered: string | null;
  select: (id: string | null) => void;
  hover: (id: string | null) => void;
  reveal: Reveal;
};

export const GraphInteractionContext = createContext<GraphInteraction>({
  selected: null,
  hovered: null,
  select: () => {},
  hover: () => {},
  reveal: { pending: false, order: new Map(), step: 0 },
});

export const useGraphInteraction = () => useContext(GraphInteractionContext);
