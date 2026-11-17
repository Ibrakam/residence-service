import { dormonBase, dormonName } from './dormon-data';

export function DormonLogo() {
  return (
    <img src={`${dormonBase}/dormon-hills/images/logo-mark.webp`} alt="" width={52} height={52} />
  );
}

export function DormonBrand({ href }: { href: string }) {
  return (
    <a className="dormon-brand" href={href}>
      <DormonLogo />
      <span>{dormonName}</span>
    </a>
  );
}
