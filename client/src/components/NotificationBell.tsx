import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import { io, Socket } from "socket.io-client";
import { getNotifications } from "@/api/notifications";
import { useAuth } from "@/hooks/useAuth";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(window.location.origin, {
      path: "/socket.io",
      transports: ["websocket", "polling"],
      autoConnect: false,
    });
  }
  return socket;
}

export default function NotificationBell() {
  const [unreadCount, setUnreadCount] = useState(0);
  const { user } = useAuth();

  const fetchCount = useCallback(async () => {
    try {
      const data = await getNotifications(1, 0);
      setUnreadCount(data.unreadCount);
    } catch {
      // silently fail
    }
  }, []);

  useEffect(() => {
    if (!user) return;

    // Initial fetch
    fetchCount();

    // Connect Socket.io for real-time updates
    const sock = getSocket();

    sock.on("connect", () => {
      sock.emit("join", user.id);
    });

    sock.on("new_notification", (payload) => {
      setUnreadCount(payload.unreadCount);
    });

    sock.connect();

    // Fallback polling — only when socket is not connected (30s)
    const interval = setInterval(() => {
      if (!sock.connected) {
        fetchCount();
      }
    }, 30000);

    return () => {
      clearInterval(interval);
      sock.off("connect");
      sock.off("new_notification");
      sock.disconnect();
    };
  }, [user, fetchCount]);

  return (
    <Link to="/notifications" className="relative text-slate-200 hover:text-white">
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      )}
    </Link>
  );
}
