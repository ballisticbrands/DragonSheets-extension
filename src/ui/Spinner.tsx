export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-block animate-spin rounded-full border-2 border-forest/30 border-t-forest"
      style={{ width: size, height: size }}
      aria-label="Loading"
    />
  );
}
