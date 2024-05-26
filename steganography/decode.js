const fs = require('fs').promises;
const yargs = require('yargs');
const wav = require('wav-decoder');
const FFT = require('fft-js').fft;
const fftUtil = require('fft-js').util;
const flac = require('flac-bindings');
const { hideBin } = require('yargs/helpers');

const { sampleRate, f0, f1, bitDuration, lowpassCutoffFrequency, signalstring } = require('./constants');

const argv = yargs(hideBin(process.argv)).argv._;

// const signalstring = '010011000100111101001100';

// const sampleRate = 44100;
// const f0 = 10; // Frequency for binary 0
// const f1 = 15; // Frequency for binary 1
// const bitDuration = 0.5; // duration of each bit in seconds

const songFile = argv[0];
const outputFile = argv[1] && argv[1].match(/\.\w{1,4}$/) ? argv[1] : `${argv[1]}.flac`;
let paddingProportion;

console.log({f0, f1, bitDuration});

const nextPowerOf2 = (n) => Math.pow(2, Math.ceil(Math.log2(n)));

const applyHammingWindow = (data) => {
    const N = data.length;
    return data.map((sample, index) => sample * (0.54 - 0.46 * Math.cos(2 * Math.PI * index / (N - 1))));
  };

const applyLowPassFilter = (data) => {
  const RC = 1.0 / (lowpassCutoffFrequency * 2 * Math.PI);
  const dt = 1.0 / sampleRate;
  const alpha = dt / (RC + dt);
  let filteredData = [];
  
  filteredData[0] = data[0];
  for (let i = 1; i < data.length; i++) {
    filteredData[i] = filteredData[i - 1] + (alpha * (data[i] - filteredData[i - 1]));
  }
  return filteredData;
};

const decodeSubsonic = (filteredSignal) => {
  const samplesPerBit = sampleRate * bitDuration;
  let binaryData = '';

//   console.log(filteredSignal.length);
  const startPercent = 0;
  start = startPercent * samplesPerBit * Math.floor(filteredSignal.length/samplesPerBit/100);

  for (let i = start; i < filteredSignal.length; i += samplesPerBit) {

    segment = applyLowPassFilter(
      applyHammingWindow(
      filteredSignal.slice(i, i + samplesPerBit)
    ));
    // console.log({segment});
    // console.log(segment.filter(el=>el));
    

    const paddedLength = nextPowerOf2(segment.length);
    paddingProportion = 1-(segment.length/ paddedLength);
    const paddedSegment = new Array(paddedLength).fill([0, 0]);

    for (let j = 0; j < segment.length; j++) {
      paddedSegment[j] = [segment[j], 0];
    }

    const phasors = FFT(paddedSegment);
    const frequencies = fftUtil.fftFreq(phasors, sampleRate);
    const magnitudes = fftUtil.fftMag(phasors);

    // console.log({ frequencies }, {length: frequencies.length});
    // console.log({ magnitudes }, {length: magnitudes.length});

    // const biasedMagnitudes = magnitudes.map ((mag,idx)=> mag/frequencies[idx]);
    // biasedMagnitudes[0] = Infinity;
    // console.log({ biasedMagnitudes }, {length: biasedMagnitudes.length});

    // const maxFrequency = frequencies[biasedMagnitudes.indexOf(Math.max(...biasedMagnitudes))];   
    const maxFrequency = frequencies[magnitudes.indexOf(Math.max(...magnitudes))];    
    console.log({maxFrequency}, Number(isHighBit(maxFrequency)));

    binaryData += Number(
      isHighBit(maxFrequency) 
        ? 1
        : isLowBit(maxFrequency) 
          ? 0
          : 0 
    );
  }

  return binaryData;
};

// const isHighBit = maxFrequency => maxFrequency > (f0 + f1) / 2 ? '1' : '0';
// const isHighBit = maxFrequency => maxFrequency == 11025;
const isHighBit = maxFrequency => maxFrequency > f1*0.9 && maxFrequency < f1*1.1;
const isLowBit = maxFrequency => maxFrequency > f0*0.9 && maxFrequency < f0*1.1;

// Read the reencoded file
(async () => {
try {
  let songData;
  fs.readFile(songFile)
    .then(async buffer => {
      if (songFile.endsWith('.flac')) {
        const flacDecoder = new flac.StreamDecoder();
        const pcmData = [];
  

        await new Promise((resolve, reject) => {
          flacDecoder.on('data', (chunk) => {
            if (chunk.buffer) {
              // Assuming chunk.buffer is a Buffer containing interleaved PCM samples
              const int16Array = new Int16Array(chunk.buffer.buffer, chunk.buffer.byteOffset, chunk.buffer.byteLength / Int16Array.BYTES_PER_ELEMENT);
              if (int16Array.length) console.log (int16Array)
              pcmData.push(...int16Array);
            }
          });
          flacDecoder.on('end', () => resolve(pcmData));
          flacDecoder.on('error', reject);
          flacDecoder.end(buffer);
        });

        console.log(pcmData)
  
        songData = new Float32Array(pcmData.map(sample => sample / 32768)); // Normalize to [-1, 1]
      } else {
        // fs.readFile(songFile)
        //   .then(wav.decode)
        //   .then((audioData) => {
    
        songData = (await wav.decode(buffer)).channelData[0];
      }

      // Apply a low-pass filter to extract the sub-sonic frequencies
      const filteredSignal = songData.map((sample, index) => {
        return index % Math.floor(sampleRate / 20) === 0 ? sample : 0;
      });

      const extractedBinaryData = decodeSubsonic(songData);
      console.log('Extracted binary data:', extractedBinaryData);
      console.log(`of which last ${paddingProportion*100}% was padding.`);
      startsAt = extractedBinaryData.indexOf(signalstring);
      console.log(`Your string ${startsAt===-1 ? 'not found' : 'starts at '+startsAt }`);
    });
} catch (err) {
  console.error(err);
}
})();
