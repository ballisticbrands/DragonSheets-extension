/**
 * AI agent (route: agent) — "describe the sheet you want, review what it
 * proposes, apply it".
 *
 * Two mechanisms cloned from hopted (teardown §6.4):
 *  1. **202 + continuation-token long-poll.** MV3 service workers can't hold a
 *     stream, so a send may come back `running` with a token we poll until it
 *     completes. The mock speaks the same contract, so Phase 8 is a client
 *     swap, not a rewrite of this screen.
 *  2. **Review-then-apply.** The agent never writes anything. It returns a
 *     proposal; Apply hands a prefilled wizard to the user, who still presses
 *     Create. No autonomous writes into someone's spreadsheet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { getBackend } from "../../backend";
import type { AgentMessage, AgentProposal, ConnectionStatus } from "../../backend/types";
import { Badge, Card } from "../../ui/Card";
import { Button } from "../../ui/Button";
import { Chip } from "../../ui/Chip";
import { Textarea } from "../../ui/Field";
import { Spinner } from "../../ui/Spinner";
import { ScreenHeader } from "../../ui/Screen";
import type { AppContext } from "../App";
import { route } from "../router";

const STARTERS = [
  "Show me my top 20 SKUs by profit last 30 days",
  "Which campaigns have ACOS above 40%?",
  "Build a restock report",
  "Which search terms are burning money?",
];

/** Poll cadence for the continuation long-poll. */
const POLL_MS = 500;

export function Agent({ ctx }: { ctx: AppContext }) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [working, setWorking] = useState(false);
  const [conn, setConn] = useState<ConnectionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState<string | null>(null);
  const cancelled = useRef(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    const backend = getBackend();
    void backend.getAgentHistory().then(setMessages);
    void backend.getConnectionStatus().then(setConn);
    return () => {
      cancelled.current = true;
    };
  }, []);

  useEffect(() => {
    ctx.scrollToBottom();
  }, [messages.length, working, ctx]);

  const anyConnected =
    conn !== null && (conn.sellerCentral.state === "connected" || conn.ads.state === "connected");

  const send = useCallback(
    async (content: string) => {
      const text = content.trim();
      if (text === "" || working) return;
      setError(null);
      setInput("");
      cancelled.current = false;
      setWorking(true);
      // Optimistic user turn — the backend records its own copy.
      setMessages((prev) => [
        ...prev,
        { id: `local_${Date.now()}`, role: "user", content: text, at: Date.now() },
      ]);
      try {
        const backend = getBackend();
        let result = await backend.sendAgentMessage(text);
        while (result.status === "running") {
          tokenRef.current = result.continuationToken;
          if (cancelled.current) return;
          await new Promise((r) => setTimeout(r, POLL_MS));
          if (cancelled.current) return;
          if (Date.now() > result.expiresAt) {
            throw new Error("The agent took too long. Try again.");
          }
          result = await backend.continueAgent(result.continuationToken);
        }
        tokenRef.current = null;
        if (cancelled.current) return;
        setMessages(await backend.getAgentHistory());
      } catch (err) {
        setError(err instanceof Error ? err.message : "The agent is unavailable right now.");
      } finally {
        setWorking(false);
      }
    },
    [working]
  );

  const stop = async () => {
    cancelled.current = true;
    setWorking(false);
    const token = tokenRef.current;
    tokenRef.current = null;
    if (token) await getBackend().cancelAgent(token);
    setMessages(await getBackend().getAgentHistory());
  };

  const resolve = async (proposal: AgentProposal, status: "applied" | "discarded") => {
    setApplying(proposal.id);
    try {
      await getBackend().resolveAgentProposal(proposal.id, status);
      setMessages(await getBackend().getAgentHistory());
      if (status === "applied") {
        ctx.navigate(route("sync-new", { proposal: proposal.id, step: "columns" }));
      }
    } finally {
      setApplying(null);
    }
  };

  const newChat = async () => {
    await getBackend().clearAgentHistory();
    setMessages([]);
    setError(null);
  };

  return (
    <div className="flex min-h-full flex-col gap-3 pt-1">
      <ScreenHeader
        title="Solve with AI"
        backLabel="Home"
        onBack={() => ctx.navigate("home")}
        action={
          messages.length > 0 ? (
            <button
              className="rounded text-[11.5px] text-ink/40 hover:text-ink focus:outline-none focus:ring-2 focus:ring-forest/30"
              onClick={() => void newChat()}
            >
              New chat
            </button>
          ) : null
        }
      />

      {!anyConnected ? (
        <Card className="border-[#F59E0B]/40 bg-[#F59E0B]/10 py-2.5">
          <p className="text-[12px] leading-relaxed text-ink/70">
            No Amazon account is linked yet, so the agent is answering from the
            report catalog alone.{" "}
            <button
              className="font-semibold text-forest underline underline-offset-2"
              onClick={() => ctx.navigate("connect-amazon")}
            >
              Connect Amazon
            </button>
          </p>
        </Card>
      ) : null}

      {messages.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-relaxed text-ink/60">
            Describe the sheet you want. The agent drafts the sync — reports,
            columns, filters, schedule — and you review it before anything gets
            written.
          </p>
          <div>
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              Try one of these
            </span>
            <div className="mt-1.5 flex flex-col items-start gap-1.5">
              {STARTERS.map((s) => (
                <Chip key={s} className="text-left" onClick={() => void send(s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              applying={applying === m.proposal?.id}
              onResolve={resolve}
            />
          ))}
        </div>
      )}

      {working ? (
        <div className="flex items-center gap-2 rounded-xl bg-ink/[0.03] px-3 py-2">
          <Spinner size={13} />
          <span className="text-[12px] text-ink/50">Working through your data…</span>
          <button
            className="ml-auto rounded text-[11.5px] font-medium text-ink/50 underline underline-offset-2 hover:text-ink focus:outline-none focus:ring-2 focus:ring-forest/30"
            onClick={() => void stop()}
          >
            Stop
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="text-[12px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-0 -mx-4 mt-auto border-t border-gray-100 bg-white/95 px-4 py-2.5 backdrop-blur">
        <Textarea
          rows={2}
          value={input}
          aria-label="Ask the agent"
          placeholder="Ask for a report…"
          disabled={working}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-[10.5px] leading-snug text-ink/40">
            Powered by your connected Amazon data. Enter to send.
          </span>
          <Button
            className="ml-auto px-3 py-1.5 text-[11.5px]"
            disabled={working || input.trim() === ""}
            onClick={() => void send(input)}
          >
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  applying,
  onResolve,
}: {
  message: AgentMessage;
  applying: boolean;
  onResolve: (proposal: AgentProposal, status: "applied" | "discarded") => Promise<void>;
}) {
  if (message.role === "system") {
    return (
      <p className="text-center text-[11px] text-ink/40">{message.content}</p>
    );
  }
  const isUser = message.role === "user";
  return (
    <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
      <div
        className={`max-w-[92%] rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed ${
          isUser ? "bg-forest text-white" : "bg-ink/[0.04] text-ink"
        }`}
      >
        {renderContent(message.content)}
      </div>
      {message.proposal ? (
        <div className="mt-2 w-full">
          <ProposalCard proposal={message.proposal} applying={applying} onResolve={onResolve} />
        </div>
      ) : null}
    </div>
  );
}

/** Minimal **bold** support — the mock replies use it, and dangerouslySetInnerHTML is not on the table. */
function renderContent(content: string): React.ReactNode {
  const parts = content.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? (
      <strong key={i} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function ProposalCard({
  proposal,
  applying,
  onResolve,
}: {
  proposal: AgentProposal;
  applying: boolean;
  onResolve: (proposal: AgentProposal, status: "applied" | "discarded") => Promise<void>;
}) {
  const settled = proposal.status !== "pending";
  return (
    <Card className={settled ? "opacity-70" : "border-forest/30"}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[13px] font-semibold text-ink">{proposal.title}</span>
        {proposal.status === "applied" ? (
          <Badge tone="lime">Applied</Badge>
        ) : proposal.status === "discarded" ? (
          <Badge tone="gray">Discarded</Badge>
        ) : (
          <Badge>Proposal</Badge>
        )}
      </div>
      <p className="mt-1 text-[12px] leading-relaxed text-ink/60">{proposal.summary}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {proposal.details.map((d) => (
          <li key={d} className="flex items-start gap-1.5 text-[11.5px] leading-snug text-ink/70">
            <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-lime" />
            <span>{d}</span>
          </li>
        ))}
      </ul>
      {settled ? (
        <p className="mt-2 text-[11px] text-ink/40">
          {proposal.status === "applied"
            ? "Opened in the sync wizard — nothing was written without you."
            : "Discarded."}
        </p>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button
            className="flex-1 px-3 py-2 text-[11.5px]"
            disabled={applying}
            onClick={() => void onResolve(proposal, "applied")}
          >
            {applying ? <Spinner size={12} /> : null}
            Apply
          </Button>
          <Button
            variant="ghost"
            className="px-3 py-2 text-[11.5px]"
            disabled={applying}
            onClick={() => void onResolve(proposal, "discarded")}
          >
            Discard
          </Button>
        </div>
      )}
    </Card>
  );
}
