import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
    plugins: [react()],
    build: {
        rollupOptions: {
            output: {
                manualChunks: function (id) {
                    var normalizedId = id.replace(/\\/g, "/");
                    if (!normalizedId.includes("node_modules")) {
                        return undefined;
                    }
                    if (normalizedId.includes("/react/") ||
                        normalizedId.includes("/react-dom/") ||
                        normalizedId.includes("/react-router") ||
                        normalizedId.includes("/scheduler/")) {
                        return "vendor-react";
                    }
                    if (normalizedId.includes("/@tanstack/")) {
                        return "vendor-query";
                    }
                    if (normalizedId.includes("/socket.io-client/")) {
                        return "vendor-realtime";
                    }
                    if (normalizedId.includes("/lucide-react/")) {
                        return "vendor-icons";
                    }
                    if (normalizedId.includes("/axios/")) {
                        return "vendor-http";
                    }
                    if (normalizedId.includes("/react-hook-form/") ||
                        normalizedId.includes("/@hookform/") ||
                        normalizedId.includes("/zod/")) {
                        return "vendor-forms";
                    }
                    if (normalizedId.includes("/sweetalert2/")) {
                        return "vendor-alerts";
                    }
                    if (normalizedId.includes("/emoji-picker-react/")) {
                        return "vendor-emoji";
                    }
                    return "vendor";
                }
            }
        }
    },
    server: {
        port: 5173
    }
});
