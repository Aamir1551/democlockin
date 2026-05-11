export default function Logo({ size = 32, textSize = '1rem', showText = true }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="40" height="40" rx="11" fill="#16a34a" />
        {/* location pin body */}
        <path
          d="M20 8C15.03 8 11 12.03 11 17c0 6.75 9 15 9 15s9-8.25 9-15c0-4.97-4.03-9-9-9z"
          fill="white"
        />
        {/* checkmark inside pin */}
        <path
          d="M16.5 17l2.5 2.5 4.5-4.5"
          stroke="#16a34a"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showText && (
        <span style={{ fontSize: textSize, fontWeight: 700, color: '#111827', letterSpacing: '-0.01em' }}>
          Locum<span style={{ color: '#16a34a' }}>Check</span>
        </span>
      )}
    </div>
  )
}
