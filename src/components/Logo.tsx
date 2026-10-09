/* Logo oficial (extraído do manual de marca TechMaster.pdf). Troca sozinho conforme o tema. */
type Props = { className?: string; mark?: boolean; alt?: string };

export function Logo({ className = "", mark = false, alt = "TechMaster Informática" }: Props) {
  if (mark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/brand/logo-mark.svg" alt={alt} className={className} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-dark.svg" alt={alt} className={`logo-on-dark ${className}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo-light.svg" alt={alt} className={`logo-on-light ${className}`} />
    </>
  );
}
