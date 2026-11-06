"use client";

import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { logoutUser } from "@/lib/auth";

interface User {
  id: string;
  email: string;
  name: string;
  role: "patient" | "therapist" | "admin";
  clinicId?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // Bumped by login and logout. The page-load check below asks who is signed
  // in; if someone logs in before its answer arrives, that answer is out of
  // date and must not sign them back out.
  const identityVersion = useRef(0);

  useEffect(() => {
    const startedAt = identityVersion.current;
    const fetchUser = async () => {
      try {
        const response = await fetch("/api/auth/me", {
          credentials: "same-origin",
          cache: "no-store",
        });
        if (identityVersion.current !== startedAt) return;

        if (!response.ok) {
          setUser(null);
        } else {
          const data = await response.json();
          if (identityVersion.current !== startedAt) return;
          setUser(data.user ?? null);
        }
      } catch (error) {
        console.error("Auth fetch error:", error);
        if (identityVersion.current === startedAt) setUser(null);
      } finally {
        if (identityVersion.current === startedAt) setLoading(false);
      }
    };

    fetchUser();
  }, []);

  const login = (user: User) => {
    identityVersion.current += 1;
    setUser(user);
    setLoading(false);
  };

  const logout = async () => {
    identityVersion.current += 1;
    setLoading(true);
    try {
      await logoutUser();
    } catch (error) {
      console.error("Logout error:", error);
    } finally {
      setUser(null);
      setLoading(false);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        isAuthenticated: !!user,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}
