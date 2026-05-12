type IconProps = {
  name: string;
  size?: number;
};

export function Icon({ name, size = 18 }: IconProps) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  };

  if (name === 'logo') {
    return (
      <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden="true">
        <rect x="3" y="3" width="8" height="38" fill="#2F3B8F" />
        <rect x="33" y="3" width="8" height="38" fill="#2F3B8F" />
        <path d="M11 3 L22 9 L33 3 L33 14 L22 20 L11 14 Z" fill="#4E8FCC" />
        <path d="M16 22 L22 25 L22 35 L16 32 Z" fill="#4E8FCC" />
        <path d="M22 25 L33 19 L33 30 L22 35 Z" fill="#2F3B8F" />
      </svg>
    );
  }

  switch (name) {
    case 'clock':
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case 'route':
      return <svg {...common}><circle cx="6" cy="5" r="2" /><circle cx="18" cy="19" r="2" /><path d="M6 7v4a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4" /></svg>;
    case 'users':
      return <svg {...common}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 19c1-3 3.5-4.5 6.5-4.5s5.5 1.5 6.5 4.5" /><circle cx="17" cy="9" r="2.5" /><path d="M16 14.5c2.5.2 4.5 1.7 5.5 4" /></svg>;
    case 'download':
      return <svg {...common}><path d="M12 4v12m-5-5 5 5 5-5" /><path d="M5 20h14" /></svg>;
    case 'settings':
      return <svg {...common}><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z" /><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 1 1-2.97 2.97l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.09 1.65V21a2.1 2.1 0 1 1-4.2 0v-.07a1.8 1.8 0 0 0-1.18-1.65 1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 1 1-2.97-2.97l.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.07 13H2a2.1 2.1 0 1 1 0-4.2h.07a1.8 1.8 0 0 0 1.65-1.18 1.8 1.8 0 0 0-.36-2l-.05-.05A2.1 2.1 0 1 1 6.28 2.6l.05.05a1.8 1.8 0 0 0 2 .36H8.4A1.8 1.8 0 0 0 9.5 1.36V1a2.1 2.1 0 1 1 4.2 0v.07a1.8 1.8 0 0 0 1.09 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 1 1 2.97 2.97l-.05.05a1.8 1.8 0 0 0-.36 2v.09A1.8 1.8 0 0 0 21 8.5h.07a2.1 2.1 0 1 1 0 4.2H21a1.8 1.8 0 0 0-1.6 1.1Z" /></svg>;
    case 'pin':
      return <svg {...common}><path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z" /><circle cx="12" cy="9" r="2.5" /></svg>;
    case 'sync':
      return <svg {...common}><path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" /><path d="M20 4v4h-4" /><path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" /><path d="M4 20v-4h4" /></svg>;
    case 'bell':
      return <svg {...common}><path d="M6 16v-5a6 6 0 1 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20a2 2 0 0 0 4 0" /></svg>;
    case 'flag':
      return <svg {...common}><path d="M5 21V4h11l-2 4 2 4H5" /></svg>;
    case 'plus':
      return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>;
    default:
      return <svg {...common}><circle cx="12" cy="12" r="9" /></svg>;
  }
}
