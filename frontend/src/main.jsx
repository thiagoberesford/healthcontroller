import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// tema guardado antes do primeiro render (evita flash de cor)
try {
  document.documentElement.classList.toggle(
    "light",
    localStorage.getItem("hc-theme") === "light",
  );
} catch (e) {}

// PWA: registar o service worker (criterio de instalavel)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
