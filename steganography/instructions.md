#### carnation-radio : steganography

## prep
```
cd steganography
yt-dlp https://www.youtube.com/watch?v=6wxiu1n474w
## If using .wav : 
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].opus -acodec pcm_u8 -ar 41000 Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav


## .wav -> .flac 16 bit
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav -af aformat=s16:44100 Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].flac

## .wav -> .mp3
ffmpeg -i Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav -acodec mp3 -ab 64k Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].mp3
```

## encode
```
## .wav
node encode.js Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav encoded.wav 

## .flac
node encode.js Paulo\ de\ Carvalho\ -\ E\ Depois\ do\ Adeus\ \(Letra\)\ \[6wxiu1n474w\].wav encoded.flac 
```

## decode
```
node decode.js encoded.<???> ---
```

## change params
`constants/index.js` contains the following:
* `sampleRate` - shouldn't need changing
* `f0` & `f1` - zero bit and one bit signalling frequencies in Hz. They should be below 40Hz to be inaudible.
* `bitDuration` - About 5 / MIN(f0, f1) works well.
* ` outputOriginalPercentage` & `outputSubsonicPercentage` - should total 100 unless intending to make the output quieter/ louder. In testing, 49:1 ratio worked well.


