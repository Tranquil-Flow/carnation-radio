export default function RadioPlayer() {
    return (
      <div className="flex flex-col items-center space-y-4">
        <div className="w-64 h-64 bg-red-500 rounded-full flex items-center justify-center">
          <div className="w-56 h-56 bg-black rounded-full flex items-center justify-center">
            <button className="w-24 h-24 bg-red-500 rounded-full flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" className="w-12 h-12 text-black">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </button>
          </div>
        </div>
        <div className="text-center">
          <p className="text-lg">Now playing: Mo Li Hua - Pin Yin</p>
          <p className="text-sm">(01:38)</p>
        </div>
      </div>
    );
  }