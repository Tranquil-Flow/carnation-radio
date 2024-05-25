const fs = require('fs').promises;
const yargs = require('yargs');
const wav = require('wav-decoder');
const WavEncoder = require('wav-encoder');
const FFT = require('fft-js').fft;
const fftUtil = require('fft-js').util;
const flac = require('flac-bindings');
const { hideBin } = require('yargs/helpers');

const { sampleRate, f0, f1, bitDuration, outputOriginalPercentage, outputSubsonicPercentage, signalstring } = require('./constants');

const argv = yargs(hideBin(process.argv)).argv._;

console.log(argv);

let direction = -1;
let previous = 0;
const didChangeDirection = (a,b) => (direction*(b-a) < 0) && (direction *= -1) ;
const width = [0];

function binaryToSubsonic(binaryData) {
  const samplesPerBit = sampleRate * bitDuration;
  let signal = [];
  let phase = 0;

  for (let bit of binaryData) {
    const frequency = bit === '1' ? f1 : f0;
    for (let i = 0; i < samplesPerBit; i++) {
      signal.push(Math.sin(2 * Math.PI * frequency * (i / sampleRate) + phase));
    }
      phase += 2 * Math.PI * frequency * (samplesPerBit / sampleRate);
  }

  Float32Array.from(signal)
    .forEach ((amp, idx)=> {
      if (didChangeDirection (previous, amp)) {
        newWidth = idx-width.pop();
        width.push (newWidth);
        width.push (idx);
        console.log (newWidth);
      }
    })


  const counts=[];
  let low=0, high=0, last=0;
  width.forEach (width=>{
    if (width > 2150 && width < 2250) {
        low++;
        if (last > -1) {
          counts.push({ low });
          low=0;
          last=-1;
        }
    }
    if (width > 1450 && width < 1500) {
        high++;
        if (last < 1) {
          counts.push({ high });
          high=0;
          last=1;
        }
    }
  })
  console.log(counts)

  return Float32Array.from(signal);
}

const subsonicSignal = binaryToSubsonic(signalstring);
const songFile = argv[0];
const outputFile = argv[1].match(/\.\w{1,4}$/) ? argv[1] : `${argv[1]}.wav`;

const overlaySignal = (songData, signal) => {
  const combined = songData.map((sample, index) => {
    const subsonicSample = signal[index] || 0;
    return sample * outputOriginalPercentage/100 + subsonicSample * outputSubsonicPercentage/100; // Adjust amplitude as needed
  });
  return combined;
};
  
(async () => {
  try {
    const buffer = await fs.readFile(songFile);
    const audioData = await wav.decode(buffer);
    const songData = audioData.channelData[0]; // Assuming mono for simplicity
    const combinedSignal = overlaySignal(songData, subsonicSignal);

    const encodedWav = {
    sampleRate: sampleRate,
    channelData: [Float32Array.from(combinedSignal)]
    };

    const encodedBuffer = await WavEncoder.encode(encodedWav);
    await fs.writeFile(outputFile, Buffer.from(encodedBuffer));
    
    console.log({ outputOriginalPercentage, outputSubsonicPercentage });
    console.log('Combined song saved as', outputFile);
  } catch (err) {
    console.error(err);
  }
})();
