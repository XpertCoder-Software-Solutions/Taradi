import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "./api";
import { debugLog } from "./debug";

let socket: Socket | null = null;
let activeToken: string | null = null;

function createSocket(token: string) {
  const nextSocket = io(SOCKET_URL, {
    autoConnect: false,
    auth: {
      token: `Bearer ${token}`
    },
    transports: ["websocket", "polling"],
    reconnection: true
  });

  return nextSocket;
}

export function connectSocket(token: string) {
  if (!token) {
    return null;
  }

  if (socket && activeToken !== token) {
    socket.removeAllListeners();
    socket.io.opts.reconnection = false;
    socket.disconnect();
    socket = null;
  }

  if (!socket) {
    socket = createSocket(token);
    activeToken = token;
  }

  socket.auth = {
    token: `Bearer ${token}`
  };
  socket.io.opts.reconnection = true;

  if (!socket.connected) {
    debugLog("Socket connect requested");
    socket.connect();
  }

  return socket;
}

export function getSocket() {
  return socket;
}

function emitLogout(currentSocket: Socket, reason: string) {
  if (!currentSocket.connected) {
    return Promise.resolve();
  }

  debugLog("socket presence:logout emitted", { reason });

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (data?: unknown) => {
      if (settled) {
        return;
      }

      settled = true;
      debugLog("socket presence:logout acknowledged", data);
      resolve();
    };

    window.setTimeout(() => finish({ timeout: true }), 1500);

    try {
      currentSocket.timeout(1200).emit("presence:logout", { reason }, (error: Error | null, response?: unknown) => {
        finish(error ? { error: error.message } : response);
      });
    } catch (error) {
      finish(error instanceof Error ? { error: error.message } : { error: "unknown" });
    }
  });
}

export async function disconnectSocket(reason = "logout") {
  const currentSocket = socket;
  activeToken = null;

  if (!currentSocket) {
    return;
  }

  debugLog("Socket disconnect requested", {
    reason,
    connected: currentSocket.connected
  });

  currentSocket.io.opts.reconnection = false;

  if (reason === "logout") {
    await emitLogout(currentSocket, reason);
  }

  currentSocket.removeAllListeners();
  currentSocket.disconnect();
  debugLog("socket disconnected", { reason });

  if (socket === currentSocket) {
    socket = null;
  }
}
