import { mountSpa } from "@workspace/skeleton/client";
import { messages } from "./messages.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";

const router = mountSpa({ routeTree, messages });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
