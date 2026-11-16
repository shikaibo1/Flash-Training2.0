import { Compass, Feather, Footprints, Gem, MessageCircle, Network, NotebookPen, Route, ScanLine, Sprout } from 'lucide-react';

const icons = { sprout: Sprout, footprints: Footprints, route: Route, compass: Compass,
  message: MessageCircle, notebook: NotebookPen, feather: Feather, network: Network,
  scan: ScanLine, gem: Gem };

export default function AchievementBadge({ icon, unlocked, large = false }: { icon: string; unlocked: boolean; large?: boolean }) {
  const Icon = icons[icon as keyof typeof icons] || Sprout;
  return <span className={`achievement-seal ${unlocked ? 'earned' : 'locked'} ${large ? 'large' : ''}`} aria-hidden="true">
    <span className="seal-inner"><Icon size={large ? 44 : 28} strokeWidth={1.45} /></span>
  </span>;
}
