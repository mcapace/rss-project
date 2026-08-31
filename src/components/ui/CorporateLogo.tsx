import Image from "next/image";
import Link from "next/link";

type Props = {
  className?: string;
  linked?: boolean;
  /** White logo treatment for dark backgrounds */
  onDark?: boolean;
  /** Height in px (defaults to 18) */
  height?: number;
};

export function CorporateLogo({
  className = "",
  linked = false,
  onDark = true,
  height = 18,
}: Props) {
  // Original aspect ratio: 1023 x 59 ≈ 17.34
  const displayWidth = Math.round((1023 / 59) * height);

  const image = (
    <Image
      src="/corporate/m-shanken-communications.png"
      alt="M. Shanken Communications"
      width={displayWidth}
      height={height}
      unoptimized
      className={`h-auto w-auto object-contain transition-opacity ${
        onDark ? "brightness-0 invert opacity-90 hover:opacity-100" : "opacity-90 hover:opacity-100"
      } ${className}`}
      style={{
        height,
        width: "auto",
      }}
      priority
    />
  );

  if (linked) {
    return (
      <Link href="/admin" className="shrink-0 inline-flex items-center">
        {image}
      </Link>
    );
  }

  return image;
}
