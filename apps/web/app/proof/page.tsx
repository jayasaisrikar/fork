import { Proof } from '@/components/proof';
import recorded from '@/data/recorded-run.json';
import { recordedStory, type RecordedRun } from '@/lib/proof';

export const metadata = { title: 'Proof · FORK' };

export default function ProofPage() {
  return <Proof story={recordedStory(recorded as unknown as RecordedRun)} />;
}
