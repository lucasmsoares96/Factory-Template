import { skeleton } from "@workspace/skeleton/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: skeleton({ dir: import.meta.dirname }),
});
