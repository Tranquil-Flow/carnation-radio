import React, { useState, useEffect } from 'react';
import { mockTracks } from '../mockData/audioTracks';

interface Track {
  id: number;
  title: string;
  artist: string;
  duration: string;
}

export function RadioPlayer() {
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isPlaying) {
      interval = setInterval(() => {
        setCurrentTrackIndex((prevIndex) => (prevIndex + 1) % mockTracks.length);
      }, 10000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  const currentTrack = mockTracks[currentTrackIndex];

  const togglePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  return (
    <div className="bg-neutral text-secondary p-4 rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-4">Carnation Radio Player</h2>
      
      {/* Mock Player UI */}
      <div className="mb-6 flex items-center space-x-4">
        <button 
          onClick={togglePlayPause}
          className="bg-primary text-secondary px-6 py-3 rounded-full text-xl"
        >
          {isPlaying ? '❚❚' : '▶'}
        </button>
        <div>
          <p className="text-lg font-semibold">{currentTrack.title}</p>
          <p>{currentTrack.artist}</p>
        </div>
        <div className="ml-auto">
          <p>{currentTrack.duration}</p>
        </div>
      </div>
      
      {/* Progress Bar (mock) */}
      <div className="w-full bg-gray-700 rounded-full h-2.5 mb-6">
        <div className="bg-primary h-2.5 rounded-full" style={{ width: '45%' }}></div>
      </div>
      
      {/* Upcoming Tracks */}
      <div>
        <h3 className="text-lg font-semibold mb-2">Up Next:</h3>
        <ul className="space-y-2">
          {[...mockTracks.slice(currentTrackIndex + 1), ...mockTracks.slice(0, currentTrackIndex)].slice(0, 5).map((track: Track) => (
            <li key={track.id} className="flex justify-between items-center py-1 border-b border-gray-700">
              <span>{track.title} - {track.artist}</span>
              <span className="text-sm">{track.duration}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default RadioPlayer;