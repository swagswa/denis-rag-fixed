import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import ChatEmbed from "./components/ChatEmbed.tsx";
import "./index.css";

// If path is /chat-embed, render the embeddable chat widget
const isChatEmbed = window.location.pathname === '/chat-embed' ||
  window.location.search.includes('embed=true');

createRoot(document.getElementById("root")!).render(
  isChatEmbed ? <ChatEmbed /> : <App />
);
