import { Landing, type Recorded } from '@/components/landing';
import recorded from '@/data/recorded-run.json';

export default function LandingPage() {
  return <Landing record={recorded as unknown as Recorded} />;
}
