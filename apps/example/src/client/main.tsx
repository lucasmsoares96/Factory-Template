import { mountSpa } from "@workspace/skeleton/client";
import product from "../../product.config.ts";
import { routeTree } from "./routeTree.gen.ts";
import "./styles.css";

const router = mountSpa({ routeTree, messages: product.messages });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
