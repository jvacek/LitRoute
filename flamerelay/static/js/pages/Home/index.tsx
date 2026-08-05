import { useLoaderData } from 'react-router';

import { Cta } from './Cta';
import { Hero } from './Hero';
import { HowItWorks } from './HowItWorks';
import { JourneyPreview } from './JourneyPreview';
import { StatsBanner } from './StatsBanner';
import type { HomeLoaderData } from './loader';

export default function Home() {
  const { stats, pins } = useLoaderData() as HomeLoaderData;

  return (
    <main>
      <Hero />
      <JourneyPreview />
      <StatsBanner stats={stats} pins={pins} />
      <HowItWorks />
      <Cta />
    </main>
  );
}
