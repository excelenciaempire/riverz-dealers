"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Eye, EyeOff, Heart, Trash2, ExternalLink } from "lucide-react";
import type { Channel, Message } from "@/types";

interface CommentModerationBarProps {
  message: Message;
  channel: Channel;
  permalink?: string;
}

/**
 * Inline moderation buttons rendered next to comment bubbles
 * (channel = 'fb_comment' | 'ig_comment'). Mirrors the actions
 * available in business.facebook.com's comment inbox.
 */
export function CommentModerationBar({ message, channel, permalink }: CommentModerationBarProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [liked, setLiked] = useState(false);

  const act = async (action: "hide" | "unhide" | "like" | "unlike" | "delete") => {
    setBusy(action);
    try {
      const res = await fetch("/api/messages/moderate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message_id: message.id, action }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error ?? `Could not ${action}`);
        return;
      }
      toast.success(labelFor(action));
      if (action === "hide") setHidden(true);
      if (action === "unhide") setHidden(false);
      if (action === "like") setLiked(true);
      if (action === "unlike") setLiked(false);
    } finally {
      setBusy(null);
    }
  };

  if (channel !== "fb_comment" && channel !== "ig_comment") return null;

  return (
    <div className="mt-1 flex items-center gap-1.5 text-xs">
      <button
        onClick={() => act(liked ? "unlike" : "like")}
        disabled={busy !== null}
        title={liked ? "Unlike" : "Like as page"}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-rose-300"
      >
        <Heart className={liked ? "size-3 fill-rose-400 text-rose-400" : "size-3"} />
      </button>
      <button
        onClick={() => act(hidden ? "unhide" : "hide")}
        disabled={busy !== null}
        title={hidden ? "Unhide" : "Hide comment"}
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-amber-300"
      >
        {hidden ? <Eye className="size-3" /> : <EyeOff className="size-3" />}
      </button>
      <button
        onClick={() => {
          if (confirm("Delete this comment? This cannot be undone.")) act("delete");
        }}
        disabled={busy !== null}
        title="Delete"
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-red-400"
      >
        <Trash2 className="size-3" />
      </button>
      {permalink && (
        <a
          href={permalink}
          target="_blank"
          rel="noopener noreferrer"
          title="Open on Facebook/Instagram"
          className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-slate-400 transition-colors hover:bg-slate-800 hover:text-slate-200"
        >
          <ExternalLink className="size-3" />
        </a>
      )}
    </div>
  );
}

function labelFor(action: string): string {
  switch (action) {
    case "hide":
      return "Comment hidden";
    case "unhide":
      return "Comment shown again";
    case "like":
      return "Liked as page";
    case "unlike":
      return "Unliked";
    case "delete":
      return "Comment deleted";
    default:
      return "Done";
  }
}
