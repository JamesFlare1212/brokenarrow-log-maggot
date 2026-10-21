export function BrandLogo({ size = 28 }: { size?: number }) {
  return (
    <img
      className="brand-logo"
      src={`${import.meta.env.BASE_URL}logo.png`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      draggable={false}
    />
  );
}
