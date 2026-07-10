type Props = {
  /** The size of the icon, 24px is default to match standard icons */
  size?: number;
  /** The color of the icon, defaults to the current text color */
  color?: string;
  /** Whether the safe area should be removed and have graphic across full size */
  cover?: boolean;
};

/**
 * Darin brand mark (three stacked bars).
 */
export default function OutlineIcon({
  size = 24,
  cover,
  color = "currentColor",
}: Props) {
  return (
    <svg
      fill={color}
      width={size}
      height={size}
      viewBox={cover ? "2 2 20 20" : "0 0 24 24"}
      version="1.1"
    >
      <rect x="4" y="5" width="10" height="3" rx="1.5" />
      <rect x="4" y="10.5" width="16" height="3" rx="1.5" />
      <rect x="4" y="16" width="13" height="3" rx="1.5" />
    </svg>
  );
}
