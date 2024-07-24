'use client';
import { AuctionInteractions } from '@/components/AuctionInteractions';
import { RadioPlayer } from '@/components/RadioPlayer';
import { ConnectButton } from '@rainbow-me/rainbowkit';

export default function Home() {
  return (
    <main className="min-h-screen bg-base-100 text-secondary">
      <header className="w-full bg-neutral p-4">
        <div className="container mx-auto flex items-center justify-between">
          <ConnectButton />
        </div>
      </header>
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8">Welcome to Carnation Radio</h1>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          <RadioPlayer />
          <AuctionInteractions />
        </div>
      </div>
    </main>
  );
}