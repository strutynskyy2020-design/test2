import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import App from "@/App";
import { registerServiceWorker } from "@/lib/pwa";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  },
});

const root = ReactDOM.createRoot(document.getElementById("root"));
// Isolated local animation bench: no account, care commands or production route.
if (process.env.NODE_ENV === "development" && window.location.pathname === "/__dev/pet-rig") {
  import("@/pages/PetRigPreview").then(({ default: Preview }) => root.render(<Preview />));
} else {
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);

registerServiceWorker();
}
