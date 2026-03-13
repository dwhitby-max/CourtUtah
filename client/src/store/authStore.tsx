import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { UserPublic } from "@shared/types";
import { isAuthenticated, clearToken } from "@/api/client";

interface AuthState {
  user: UserPublic | null;
  isLoggedIn: boolean;
  setUser: (user: UserPublic | null) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoggedIn: false,
  setUser: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserPublic | null>(() => {
    const stored = localStorage.getItem("auth_user");
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });

  const isLoggedIn = isAuthenticated() && user !== null;

  useEffect(() => {
    if (user) {
      localStorage.setItem("auth_user", JSON.stringify(user));
    } else {
      localStorage.removeItem("auth_user");
    }
  }, [user]);

  function logout() {
    clearToken();
    setUser(null);
    window.location.href = "/login";
  }

  return (
    <AuthContext.Provider value={{ user, isLoggedIn, setUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  return useContext(AuthContext);
}
