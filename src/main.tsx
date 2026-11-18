import { render } from "preact";
import "@fontsource/dancing-script/600.css";
import "./styles.css";
import { App } from "./App";

render(<App />, document.getElementById("root")!);

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
