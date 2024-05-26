
const sampleRate = 44100;
const f0 = 10; // Frequency for binary 0
const f1 = 15; // Frequency for binary 1
const bitDuration = 0.5; // Duration of each bit in seconds

// Encoder
const outputOriginalPercentage = 98;
const outputSubsonicPercentage = 2;

// Decoder
const lowpassCutoffFrequency = 50; // Low-pass filter cutoff frequency in Hz
const signalstring = '010011000100111101001100';

module.exports = { sampleRate, f0, f1, bitDuration, outputOriginalPercentage, outputSubsonicPercentage, signalstring };