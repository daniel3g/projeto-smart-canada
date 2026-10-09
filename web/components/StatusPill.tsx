type Tone = "online" | "offline" | "pending";

const TONE_CLASS: Record<Tone, string> = {
  online: "bg-online-soft text-online",
  offline: "bg-offline-soft text-offline",
  pending: "bg-pending-soft text-pending",
};

export function StatusPill({
  tone,
  children,
}: {
  tone: Tone;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      <span
        aria-hidden
        className="size-1.5 rounded-full bg-current"
      />
      {children}
    </span>
  );
}
