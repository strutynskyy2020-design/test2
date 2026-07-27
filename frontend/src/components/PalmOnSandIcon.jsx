export default function PalmOnSandIcon({ size = 24, strokeWidth = 2.4, className = "", ...props }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...props}
    >
      <path d="M3.5 20c2.3-1.15 5.12-1.72 8.5-1.72S18.2 18.85 20.5 20" />
      <path d="M12 18.2c.55-3.65.18-7.02-1.1-10.1" />
      <path d="M11 8.2C8.35 6.15 5.5 6.2 3.8 8.05c2.42-.08 4.43.56 6.03 1.92" />
      <path d="M11.15 8.05C12.3 5.1 14.72 3.8 17.3 4.72c-1.9.9-3.33 2.1-4.25 3.62" />
      <path d="M11.3 8.25c2.68-.55 5.03.5 6.08 2.72-1.88-.6-3.58-.58-5.03.08" />
      <path d="M11.05 8.08C9.9 5.55 7.65 4.28 5.38 5.05c1.62.77 2.95 1.85 3.9 3.25" />
      <path d="M8.5 20.1h7" />
    </svg>
  );
}
