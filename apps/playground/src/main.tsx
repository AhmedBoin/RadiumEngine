import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

/* RadiumEngine does not import peer styles for you: do it once, here. */
import "leaflet/dist/leaflet.css";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
