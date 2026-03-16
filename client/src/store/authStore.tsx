import { createContext, useContext, useState, ReactNode } from "react";
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
  const [user, setUserState] = useState<UserPublic | null>(() => {
    const stored = localStorage.getItem("auth_user");
    if (stored) {
      try { return JSON.parse(stored); } catch { return null; }
    }
    return null;
  });

  const isLoggedIn = isAuthenticated() && user !== null;

  // Write to localStorage synchronously so navigations don't lose state
  function setUser(newUser: UserPublic | null) {
    if (newUser) {
      localStorage.setItem("auth_user", JSON.stringify(newUser));
    } else {
      localStorage.removeItem("auth_user");
    }
    setUserState(newUser);
  }

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
