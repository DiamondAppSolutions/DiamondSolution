interface DiamondLogoProps {
  size?: number;
  layout?: "vertical" | "horizontal" | "icon";
  variant?: "navy" | "white" | "gold";
  showTagline?: boolean;
  className?: string;
}

const VARIANT_COLOR: Record<
  NonNullable<DiamondLogoProps["variant"]>,
  string
> = {
  navy: "#0B1E3D",
  white: "#FFFFFF",
  gold: "#D4AF37",
};

function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size * 1.15}
      viewBox="0 0 400 480"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      <g fill={color}>
        {/* Mortarboard */}
        <polygon points="200,20 385,100 200,180 15,100" />
        <path d="M 115,145 C 160,168 240,168 285,145 L 285,158 C 240,181 160,181 115,158 Z" />
        {/* Tassel */}
        <circle cx="200" cy="100" r="7.5" />
        <path
          d="M 200,100 C 110,110 72,142 72,190 L 72,238"
          stroke={color}
          strokeWidth={8}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx="72" cy="242" r="8" />
        <path d="M 61,250 C 55,298 89,298 83,250 Z" />
        {/* D monogram */}
        <path d="M 110,158 L 154,158 L 154,395 L 110,395 Z" />
        <path d="M 148,158 C 255,158 318,198 318,275 C 318,352 255,395 148,395 L 148,348 C 220,348 268,318 268,275 C 268,232 220,205 148,205 Z" />
        {/* S monogram */}
        <path d="M 215,232 C 270,232 328,252 328,292 C 328,332 272,348 222,360 C 180,370 162,390 162,418 C 162,456 218,474 278,474 C 318,474 348,460 348,440 C 348,426 332,426 322,436 C 308,450 288,456 268,456 C 225,456 198,440 198,418 C 198,398 220,388 262,378 C 312,366 362,342 362,292 C 362,242 308,215 235,215 C 200,215 172,225 172,242 C 172,253 186,253 196,244 C 208,236 226,232 242,232 Z" />
      </g>
    </svg>
  );
}

export function DiamondLogo({
  size = 56,
  layout = "vertical",
  variant = "navy",
  showTagline = false,
  className = "",
}: DiamondLogoProps) {
  const color = VARIANT_COLOR[variant];
  const wordmarkColor =
    variant === "gold"
      ? "#D4AF37"
      : variant === "white"
        ? "#FFFFFF"
        : "#0B1E3D";
  const taglineColor = variant === "white" ? "#CBD5E1" : "#475569";

  if (layout === "icon") {
    return (
      <div className={`inline-flex items-center justify-center ${className}`}>
        <Mark size={size} color={color} />
      </div>
    );
  }

  const text = (
    <>
      <span
        className="font-heading font-extrabold leading-none tracking-tight"
        style={{ color: wordmarkColor, fontSize: Math.max(18, size * 0.4) }}
      >
        Diamond Solution
      </span>
      {showTagline && (
        <span
          className="mt-1 font-sans text-xs font-medium"
          style={{ color: taglineColor }}
        >
          Committed to raising first-class professionals.
        </span>
      )}
    </>
  );

  if (layout === "horizontal") {
    return (
      <div className={`inline-flex items-center gap-3 ${className}`}>
        <Mark size={size} color={color} />
        <div className="flex flex-col justify-center">{text}</div>
      </div>
    );
  }

  return (
    <div
      className={`inline-flex flex-col items-center text-center ${className}`}
    >
      <Mark size={size} color={color} />
      <div className="mt-3 flex flex-col items-center">{text}</div>
    </div>
  );
}
