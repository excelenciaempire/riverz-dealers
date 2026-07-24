"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * CommentViewProvider — owns whether FB/IG/TikTok comments render in the
 * "native" look (avatar + threaded reply layout, like the source app) or the
 * "classic" chat-bubble look the rest of the inbox uses.
 *
 * Device-scoped (localStorage only), same rationale as the theme: a per-device
 * choice is fine and avoids a round-trip. Default is "native" — that's the
 * requested primary experience; the Apariencia toggle flips back to "classic".
 */

export type CommentView = "native" | "classic";

export const COMMENT_VIEW_STORAGE_KEY = "riverz.commentView";
export const DEFAULT_COMMENT_VIEW: CommentView = "native";

export function isCommentView(v: unknown): v is CommentView {
  return v === "native" || v === "classic";
}

interface CommentViewContextValue {
  commentView: CommentView;
  setCommentView: (next: CommentView) => void;
}

const CommentViewContext = createContext<CommentViewContextValue | null>(null);

function readInitial(): CommentView {
  if (typeof window === "undefined") return DEFAULT_COMMENT_VIEW;
  try {
    const stored = localStorage.getItem(COMMENT_VIEW_STORAGE_KEY);
    if (isCommentView(stored)) return stored;
  } catch {
    // localStorage can throw in private-browsing / sandboxed contexts.
  }
  return DEFAULT_COMMENT_VIEW;
}

export function CommentViewProvider({ children }: { children: ReactNode }) {
  const [commentView, setState] = useState<CommentView>(readInitial);

  const setCommentView = useCallback((next: CommentView) => {
    setState(next);
    try {
      localStorage.setItem(COMMENT_VIEW_STORAGE_KEY, next);
    } catch {
      // In-memory state still updates so the current tab works this session.
    }
  }, []);

  // Cross-tab sync — flipping the toggle in one tab catches the others up.
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== COMMENT_VIEW_STORAGE_KEY) return;
      if (isCommentView(e.newValue) && e.newValue !== commentView) {
        setState(e.newValue);
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [commentView]);

  return (
    <CommentViewContext.Provider value={{ commentView, setCommentView }}>
      {children}
    </CommentViewContext.Provider>
  );
}

export function useCommentView(): CommentViewContextValue {
  const ctx = useContext(CommentViewContext);
  if (!ctx) {
    // Outside the provider (shouldn't happen in-app) — default + no-op setter.
    return { commentView: DEFAULT_COMMENT_VIEW, setCommentView: () => {} };
  }
  return ctx;
}
